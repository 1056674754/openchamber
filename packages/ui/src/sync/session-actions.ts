/**
 * Session actions — SDK-calling operations for session management.
 * Replaces the action methods from the old useSessionStore.
 */

import type { OpencodeClient, Session, Message, Part, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"
import { Binary } from "./binary"
import { useSessionUIStore } from "./session-ui-store"
import { useInputStore } from "./input-store"
import type { ChildStoreManager } from "./child-store"
import { requireSessionAuthority, UnresolvedSessionServerError } from "./session-authority"
import { useGlobalSessionsStore, resolveGlobalSessionDirectory } from "@/stores/useGlobalSessionsStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { registerSessionDirectory } from "./sync-refs"
import { recordSendFailure } from "./send-failure-log"
import { isSyntheticPart } from "@/lib/messages/synthetic"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { getSyncStoresForServer, getAllSyncStores } from "./multi-server-registry"
import { materializeSessionSnapshots } from "./materialization"
import { persistSteerSideChannelMessage } from "./steer-side-channel"
import { stripMessageDiffSnapshots } from "./sanitize"
import { formatSdkError } from "./sdk-error"
import { withLinkedIssue, type LinkedIssue } from "@/lib/linkedIssues"
import { getErrorStatus, isAmbiguousSendFailure } from "./send-failure-classification"
import { markAmbiguousTransportFailure } from "@/lib/relay/transport-error"
import { sessionEvents } from "@/lib/sessionEvents"
import { hasTerminalMessageSignal, type TerminalMessageSignalInfo } from "@/lib/messageCompletion"
import { formatMessage, useI18nStore } from "@/lib/i18n/store"
import {
  getOrRegisterRemoteConnection,
  getServerIdForBaseUrl,
  normalizeDirectoryKey,
  resolveApiUrl,
  resolveBaseUrl,
  resolveBaseUrlForSession,
  resolveProjectServerIdForDirectory,
  resolveSdkForDirectory as resolveSdkForDirectoryFromRouting,
  setDirectoryServerId,
} from "./session-routing"
import {
  withContextObligatoryMessage,
  type ContextObligatoryMessage,
} from "@/lib/contextObligatoryMessages"
import { getRuntimeKey } from "@/lib/runtime-switch"
import { runtimeFetch } from "@/lib/runtime-fetch"
import { messagesBefore, messagesFrom, sortMessagesChronologically } from './message-ordering'
import { cleanupBtwBeforeSessionRemoval } from '@/lib/sessionBtwLifecycle'
import { deleteChatDirectory, isChatDirectoryPath } from '@/lib/chatDirectories'
import { requestSessionArchiveBatch } from "./session-archive-batch"
import { registerBulkArchiveEchoes, releaseBulkArchiveEchoes } from "./bulk-archive-echo"
import { isReviewSession } from '@/lib/sessionReviewMetadata'
import { isBtwSession, getBtwSessionID } from '@/lib/sessionBtwMetadata'

export {
  resolveApiUrl,
  resolveBaseUrl,
  resolveBaseUrlForSession,
  resolveProjectServerIdForDirectory,
  setDirectoryServerId,
}

const MESSAGE_REFETCH_LIMIT = 200
const SEND_CONFIRMATION_REFETCH_LIMIT = 30
const SEND_CONFIRMATION_REFETCH_ATTEMPTS = 2
const SEND_CONFIRMATION_REFETCH_RETRY_MS = 150
const MESSAGE_REFETCH_SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const UNREVERT_REFETCH_ATTEMPTS = 3
const UNREVERT_REFETCH_RETRY_MS = 150
const SESSION_IDLE_GRACE_MS = 3_000

function isStaleRuntime(expectedRuntimeKey: string | undefined): boolean {
  return expectedRuntimeKey !== undefined && getRuntimeKey() !== expectedRuntimeKey
}

export type ArchiveSessionsOptions = {
  expectedRuntimeKey?: string
}

type BuildOptimisticPartsInput = {
  messageID: string
  createPartID: () => string
}

export type SendDeliveryMode = "normal" | "steer"

export type BlockingRequestTarget = {
  readonly directory?: string
  readonly serverId?: string
}

export class SessionBusyError extends Error {
  readonly sessionId: string
  readonly deliveryMode: SendDeliveryMode

  constructor(sessionId: string, deliveryMode: SendDeliveryMode, message?: string) {
    super(message ?? `Session ${sessionId} is already running; queue the message or stop the current run before sending.`)
    this.name = "SessionBusyError"
    this.sessionId = sessionId
    this.deliveryMode = deliveryMode
  }
}

// Reference set by SyncProvider — allows actions to access SDK and stores
let _sdk: OpencodeClient | null = null
let _childStores: ChildStoreManager | null = null
let _getDirectory: () => string = () => ""
let _optimisticAdd: ((input: { sessionID: string; message: Message; parts: Part[]; directory?: string | null; serverId?: string | null }) => void) | null = null
let _optimisticRemove: ((input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => void) | null = null
let _optimisticConfirm: ((input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => void) | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function isNonIdleStatus(status: SessionStatus | undefined): boolean {
  return status !== undefined && status.type !== "idle"
}

function hasBlockingPendingAssistant(
  state: ReturnType<ReturnType<ChildStoreManager["ensureChild"]>["getState"]>,
  sessionId: string,
  now: number,
): boolean {
  const status = state.session_status[sessionId]
  const messages = state.message[sessionId] ?? []
  let pendingAssistant = false

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === "user") break
    if (message.role === "assistant") {
      pendingAssistant = !hasTerminalMessageSignal(message as TerminalMessageSignalInfo)
      break
    }
  }

  if (!pendingAssistant) return false
  if (status === undefined) return true
  if (status.type !== "idle") return true

  const lastActivityAt = state.session_activity[sessionId]
  return typeof lastActivityAt === "number" && now - lastActivityAt < SESSION_IDLE_GRACE_MS
}

function isSessionBlockedForSend(
  store: ReturnType<ChildStoreManager["ensureChild"]>,
  sessionId: string,
): boolean {
  const state = store.getState()
  return isNonIdleStatus(state.session_status[sessionId])
    || hasBlockingPendingAssistant(state, sessionId, Date.now())
}

async function resolveBlockedSessionBeforeSend(
  input: {
    sessionId: string
    deliveryMode?: SendDeliveryMode
  },
): Promise<void> {
  // Steer mode: inject as context via V2 API — never reject for busy, never abort.
  // The V2 /api/session/{id}/prompt endpoint with delivery:"steer" handles busy
  // sessions natively by promoting the input at the next step boundary.
  if (input.deliveryMode === "steer") {
    return
  }

  throw new SessionBusyError(input.sessionId, input.deliveryMode ?? "normal")
}

export function setActionRefs(
  sdk: OpencodeClient,
  childStores: ChildStoreManager,
  getDirectory: () => string,
) {
  _sdk = sdk
  _childStores = childStores
  _getDirectory = getDirectory
}

export function setOptimisticRefs(
  add: (input: { sessionID: string; message: Message; parts: Part[]; directory?: string | null; serverId?: string | null }) => void,
  remove: (input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => void,
  confirm?: (input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => void,
) {
  _optimisticAdd = add
  _optimisticRemove = remove
  _optimisticConfirm = confirm ?? null
}

function sdk() {
  if (!_sdk) throw new Error("SDK not initialized — is SyncProvider mounted?")
  return _sdk
}

/** Get the SDK client for a session's server.
 *  sessionId with no authoritative binding fails closed (never silently local)
 *  unless a directory context is supplied, in which case the directory's
 *  ownership resolves the client (the directory is an explicit request scope,
 *  not global state). */
function sdkForSession(sessionId?: string | null, directory?: string | null): OpencodeClient {
  if (sessionId) {
    if (!directory) {
      const { serverId } = requireSessionAuthority(sessionId)
      if (serverId && serverId !== DEFAULT_SERVER_ID) {
        return getOrRegisterRemoteConnection(serverId).client
      }
      const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
      if (defaultConn) return defaultConn.client
      return sdk()
    }
    return resolveSdkForDirectoryFromRouting(directory, sessionId, undefined, _sdk)
  }
  const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConn) return defaultConn.client
  return sdk()
}

/** Resolve the correct SDK client for a directory by looking up its project's serverId.
 *  When sessionID or explicitServerId is provided, uses the authoritative serverRegistry session index. */
export function resolveSdkForDirectory(directory: string, sessionID?: string, explicitServerId?: string): OpencodeClient {
  return resolveSdkForDirectoryFromRouting(directory, sessionID, explicitServerId, _sdk)
}

function storesForSession(sessionId?: string | null, directory?: string | null): ChildStoreManager {
  if (sessionId && !directory) {
    const { serverId } = requireSessionAuthority(sessionId)
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const stores = getSyncStoresForServer(serverId)
      if (stores) return stores
      throw new UnresolvedSessionServerError(sessionId)
    }
  } else if (sessionId && directory) {
    // Directory is an explicit scope; resolve its owning server's stores.
    const baseUrl = resolveBaseUrl(directory)
    const resolvedServerId = baseUrl ? getServerIdForBaseUrl(baseUrl) : DEFAULT_SERVER_ID
    if (resolvedServerId && resolvedServerId !== DEFAULT_SERVER_ID) {
      const stores = getSyncStoresForServer(resolvedServerId)
      if (stores) return stores
      throw new UnresolvedSessionServerError(sessionId)
    }
  }
  if (!_childStores) throw new Error("Child stores not initialized")
  return _childStores
}

function upsertSessionSnapshot(
  store: ReturnType<ChildStoreManager["ensureChild"]>,
  session: Session,
) {
  const current = store.getState()
  const sessions = [...current.session]
  const searchResult = Binary.search(sessions, session.id, (s) => s.id)
  if (searchResult.found) {
    sessions[searchResult.index] = session
  } else {
    sessions.splice(searchResult.index, 0, session)
  }
  store.setState({ session: sessions })
}

function unwrapMessageRecords<T>(
  result: { data?: T[]; error?: unknown; response?: { status?: number } },
  name: string,
): T[] {
  return unwrapSdkData(result, name)
}

function unwrapSdkData<T>(
  result: { data?: T; error?: unknown; response?: { status?: number } },
  name: string,
): T {
  if (result.error) {
    const status = result.response?.status
    const rawError = result.error
    const message = formatSdkError(rawError)
    const error = new Error(`${name} failed${status ? ` (${status})` : ""}: ${message}`)
    if (status !== undefined) {
      ;(error as Error & { status?: number }).status = status
    }
    throw error
  }
  if (result.data === undefined) {
    const error = new Error(`${name} returned no data`)
    ;(error as Error & { status?: number }).status = 503
    throw error
  }
  return result.data
}

/** Get the directory store for a session. Uses the remote server's child stores
    (keyed by "" since MultiServerSyncLayer mounts with directory="") for remote sessions,
    or the session/current directory's store for local sessions. */
function storeForSession(
  sessionId: string | null | undefined,
  directoryHint?: string | null,
  serverIdHint?: string | null,
): ReturnType<ChildStoreManager["ensureChild"]> {
  const hintedDirectory = directoryHint ? normalizeDirectoryKey(directoryHint) : undefined
  if (sessionId) {
    const serverId = serverIdHint ?? serverRegistry.getServerForSession(sessionId)
    const sessionDirectory = hintedDirectory ?? getSessionDirectory(sessionId)
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const remoteStores = getSyncStoresForServer(serverId)
      if (remoteStores) {
        if (sessionDirectory) {
          return remoteStores.ensureChild(sessionDirectory)
        }
        const store = remoteStores.getChild("")
        if (store) return store
      }
    }
    if (sessionDirectory && _childStores) {
      const store = _childStores.getChild(sessionDirectory)
      if (store) return store
    }
    if (sessionDirectory && _childStores) {
      return _childStores.ensureChild(sessionDirectory)
    }
  }
  if (!sessionId) return getDirectoryStore(hintedDirectory)
  throw new Error(`Directory store for session ${sessionId} is not available`)
}

function connectionLostError(serverId?: string | null): Error {
  const normalizedServerId = serverId || DEFAULT_SERVER_ID
  const { hasEverConnected, lastDisconnectReason } = useConfigStore.getState().getConnectionState(normalizedServerId)
  const { dictionary } = useI18nStore.getState()

  if (!hasEverConnected) {
    return new Error(formatMessage(dictionary, "chat.connectionLost.neverConnected"))
  }
  if (lastDisconnectReason === "upstream_stalled") {
    return new Error(formatMessage(dictionary, "chat.connectionLost.upstreamStalled"))
  }
  if (normalizedServerId !== DEFAULT_SERVER_ID) {
    return new Error(formatMessage(dictionary, "chat.connectionLost.remote", {
      server: serverRegistry.getServerLabel(normalizedServerId),
    }))
  }
  return new Error(formatMessage(dictionary, "chat.connectionLost.reconnecting"))
}

// Wait briefly for the pipeline to re-establish connection before failing a
// send. Transient reconnects (heartbeat race, WS→SSE fallback, brief network
// blip) otherwise surface as a hard "Connection lost" toast even though the
// pipeline recovers within a second. Do NOT run independent health probes
// here — the pipeline already reconnects autonomously and health probes race
// it through the same potentially slow OpenCode process.
const CONNECTION_GRACE_MS = 2000
export async function waitForConnectionOrThrow(serverId?: string | null): Promise<void> {
  const normalizedServerId = serverId || DEFAULT_SERVER_ID
  const deadline = Date.now() + CONNECTION_GRACE_MS
  while (Date.now() < deadline) {
    if (useConfigStore.getState().getConnectionState(normalizedServerId).isConnected) return
    const sleepMs = Math.min(50, deadline - Date.now())
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
  throw connectionLostError(normalizedServerId)
}

function getSessionDirectory(sessionId: string): string | undefined {
  const uiDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId)
  if (uiDirectory) return uiDirectory

  const serverId = serverRegistry.getServerForSession(sessionId)
  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remoteStores = getSyncStoresForServer(serverId)
    if (remoteStores) {
      for (const [directory, store] of remoteStores.children) {
        const state = store.getState()
        if (
          state.session.some((session) => session.id === sessionId)
          || Object.prototype.hasOwnProperty.call(state.message, sessionId)
          || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionId)
          || Object.prototype.hasOwnProperty.call(state.permission ?? {}, sessionId)
          || Object.prototype.hasOwnProperty.call(state.question ?? {}, sessionId)
        ) {
          return directory
        }
      }
    }
  }

  if (_childStores) {
    for (const [directory, store] of _childStores.children) {
      const state = store.getState()
      if (
        state.session.some((session) => session.id === sessionId)
        || Object.prototype.hasOwnProperty.call(state.message, sessionId)
        || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionId)
        || Object.prototype.hasOwnProperty.call(state.permission ?? {}, sessionId)
        || Object.prototype.hasOwnProperty.call(state.question ?? {}, sessionId)
      ) {
        return directory
      }
    }
  }

  return undefined
}

function requireSessionDirectory(sessionId: string, operation: string): string {
  const sessionDirectory = getSessionDirectory(sessionId)
  if (!sessionDirectory) {
    throw new Error(`${operation}: directory for session ${sessionId} is not available`)
  }
  return sessionDirectory
}

/** "unknown" means no live source covers this session right now, so no caller
 *  may treat it as idle on this answer. "idle" requires positive coverage. */
export type SessionLiveActivity = "unknown" | "idle" | "active"

/**
 * A session's live status can live in a child store of ANY server — including
 * a directory other than the one that wins the directory dedup — so every
 * server's child stores are scanned, and any store reporting a non-idle status
 * counts. Read at the moment of use: a descendant can start working after the
 * subtree snapshot was taken.
 *
 * Absence of a non-idle status is not proof of idleness. Child stores are
 * evicted for background directories, so "no report" and "idle" are different
 * answers: report "idle" only when a child store actually covers the session
 * (it holds the session's records) or the global status index still tracks it.
 * The global index is fed by the SSE pipeline and survives child-store
 * eviction; unlike upstream's non-idle-only index it also retains idle
 * entries, which is exactly what makes it usable as coverage evidence here.
 */
export function getSessionLiveActivity(sessionId: string): SessionLiveActivity {
  const serverManagers: Array<ChildStoreManager> = []
  if (_childStores) serverManagers.push(_childStores)
  for (const entry of getAllSyncStores()) {
    if (entry.childStores && entry.childStores !== _childStores) {
      serverManagers.push(entry.childStores)
    }
  }

  let covered = false
  for (const stores of serverManagers) {
    for (const [, store] of stores.children) {
      const state = store.getState()
      const status = state.session_status?.[sessionId]
      if (status && status.type !== "idle") return "active"
      if (
        !covered
        && (Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionId)
          || state.session.some((session) => session.id === sessionId))
      ) {
        covered = true
      }
    }
  }

  const globalStatus = useGlobalSessionsStore.getState().sessionStatuses.get(sessionId)
  if (globalStatus) {
    if (globalStatus.type !== "idle") return "active"
    covered = true
  }

  return covered ? "idle" : "unknown"
}

export function isSessionBusyNow(sessionId: string): boolean {
  return getSessionLiveActivity(sessionId) === "active"
}

function getDirectoryStore(directory?: string) {
  if (!_childStores) throw new Error("Child stores not initialized")
  const resolvedDirectory = directory || _getDirectory()
  if (!resolvedDirectory) throw new Error("No current directory")
  return _childStores.ensureChild(resolvedDirectory)
}

function getSessionReplyClient(sessionId?: string): OpencodeClient {
  if (sessionId) {
    const conn = serverRegistry.getClientForSession(sessionId)
    if (conn) return conn.client
  }
  const directory = sessionId
    ? useSessionUIStore.getState().getDirectoryForSession(sessionId)
    : null
  if (directory) {
    return resolveSdkForDirectory(directory, sessionId)
  }
  throw new Error(`Reply target directory for session ${sessionId ?? "(unknown)"} is not available`)
}

function findBlockingRequestDirectoryInStores(
  stores: ChildStoreManager,
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): string | null {
  for (const [directory, store] of stores.children) {
    const state = store.getState()
    const requestMap = type === "permission" ? state.permission : state.question
    const sessionRequests = requestMap[sessionId]
    if (sessionRequests?.some((request) => request.id === requestId)) {
      return directory
    }
  }

  for (const [directory, store] of stores.children) {
    const state = store.getState()
    const requestMap = type === "permission" ? state.permission : state.question
    for (const requests of Object.values(requestMap) as Array<Array<{ id: string }> | undefined>) {
      if (requests?.some((request) => request.id === requestId)) {
        return directory
      }
    }
  }

  return null
}

function resolveDirectoryForBlockingRequest(
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): string | null {
  if (!requestId) {
    return null
  }

  const serverId = serverRegistry.getServerForSession(sessionId)
  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remoteStores = getSyncStoresForServer(serverId)
    const remoteDirectory = remoteStores
      ? findBlockingRequestDirectoryInStores(remoteStores, type, sessionId, requestId)
      : null
    if (remoteDirectory) return remoteDirectory
  }

  const stores = _childStores
  const localDirectory = stores
    ? findBlockingRequestDirectoryInStores(stores, type, sessionId, requestId)
    : null
  if (localDirectory) return localDirectory

  for (const entry of getAllSyncStores()) {
    if (entry.serverId === DEFAULT_SERVER_ID || entry.serverId === serverId) continue
    const directory = findBlockingRequestDirectoryInStores(entry.childStores, type, sessionId, requestId)
    if (directory) return directory
  }

  const sessionDirectory = getSessionDirectory(sessionId)
  if (sessionDirectory) {
    return sessionDirectory
  }

  if (!stores) {
    return null
  }

  for (const [directory, store] of stores.children) {
    const state = store.getState()
    if (
      state.session.some((session) => session.id === sessionId)
      || Object.prototype.hasOwnProperty.call(state.message, sessionId)
      || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionId)
      || Object.prototype.hasOwnProperty.call(state.permission ?? {}, sessionId)
      || Object.prototype.hasOwnProperty.call(state.question ?? {}, sessionId)
    ) {
      return directory
    }
  }

  return null
}

function getRequestReplyClient(
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): OpencodeClient {
  const conn = serverRegistry.getClientForSession(sessionId)
  if (conn) return conn.client
  const requestDirectory = resolveDirectoryForBlockingRequest(type, sessionId, requestId)
  if (requestDirectory) {
    return resolveSdkForDirectory(requestDirectory, sessionId)
  }
  return getSessionReplyClient(sessionId)
}

function requireBlockingRequestDirectory(
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): string {
  const directory = resolveDirectoryForBlockingRequest(type, sessionId, requestId)
  if (!directory) {
    throw new Error(`${type} reply target directory for request ${requestId} is not available`)
  }
  return directory
}

function removeQuestionFromStores(
  stores: ChildStoreManager | undefined,
  sessionId: string,
  requestId: string,
): boolean {
  if (!stores) return false

  for (const store of stores.children.values()) {
    const questions = store.getState().question[sessionId]
    if (!questions || questions.length === 0) continue
    const next = questions.filter((question) => question.id !== requestId)
    if (next.length === questions.length) continue

    const question = { ...store.getState().question }
    if (next.length === 0) {
      delete question[sessionId]
    } else {
      question[sessionId] = next
    }
    store.setState({ question })
    return true
  }

  return false
}

function removePermissionFromStores(
  stores: ChildStoreManager | undefined,
  sessionId: string,
  requestId: string,
): boolean {
  if (!stores) return false

  for (const store of stores.children.values()) {
    const permissions = store.getState().permission[sessionId]
    if (!permissions || permissions.length === 0) continue
    const next = permissions.filter((permission) => permission.id !== requestId)
    if (next.length === permissions.length) continue

    const permission = { ...store.getState().permission }
    if (next.length === 0) {
      delete permission[sessionId]
    } else {
      permission[sessionId] = next
    }
    store.setState({ permission })
    return true
  }

  return false
}

function optimisticRemoveQuestion(sessionId: string, requestId: string): void {
  if (!sessionId || !requestId) return

  const serverId = serverRegistry.getServerForSession(sessionId)
  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    if (removeQuestionFromStores(getSyncStoresForServer(serverId), sessionId, requestId)) {
      return
    }
  }

  if (removeQuestionFromStores(_childStores ?? undefined, sessionId, requestId)) {
    return
  }

  for (const entry of getAllSyncStores()) {
    if (entry.serverId === DEFAULT_SERVER_ID || entry.serverId === serverId) continue
    if (removeQuestionFromStores(entry.childStores, sessionId, requestId)) {
      return
    }
  }
}

function resolveBlockingRequestServerId(sessionId: string, directoryHint?: string): string | undefined {
  const indexedServerId = serverRegistry.getServerForSession(sessionId)
  if (indexedServerId) return indexedServerId
  if (directoryHint) {
    // Directory is an explicit request context; resolve its ownership
    // directly rather than through the (possibly unindexed) session.
    const baseUrl = resolveBaseUrl(directoryHint)
    const fromBaseUrl = baseUrl ? getServerIdForBaseUrl(baseUrl) : undefined
    if (fromBaseUrl) return fromBaseUrl
    // Directory resolves to no remote server: the request originated on the
    // default/local connection, so reply there. Fail-closed enforcement for
    // session-scoped mutations lives in sdkForSession/storesForSession, which
    // throw when a session has no binding at all.
    return DEFAULT_SERVER_ID
  }
  return undefined
}

function hasSuccessfulSdkResult(result: unknown): boolean {
  if (!result || typeof result !== "object") {
    return false
  }
  return Boolean((result as { data?: unknown }).data)
}

function getSdkResultStatus(result: unknown): number | undefined {
  if (!result || typeof result !== "object") {
    return undefined
  }
  const response = (result as { response?: unknown }).response
  if (!response || typeof response !== "object") {
    return undefined
  }
  const status = (response as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

// ---------------------------------------------------------------------------
// Session directory move (worktree)
// ---------------------------------------------------------------------------

function moveRecordEntries<T>(
  source: Record<string, T>,
  destination: Record<string, T>,
  keys: Iterable<string>,
): { source: Record<string, T>; destination: Record<string, T> } {
  let nextSource = source
  let nextDestination = destination

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    if (nextSource === source) nextSource = { ...source }
    if (nextDestination === destination) nextDestination = { ...destination }
    nextDestination[key] = source[key]
    delete nextSource[key]
  }

  return { source: nextSource, destination: nextDestination }
}

function reconcileSessionMove(
  session: Session,
  sourceDirectory: string,
  destinationDirectory: string,
): Session {
  const stores = storesForSession(session.id, sourceDirectory)
  const sourceStore = stores.getChild(sourceDirectory)
  const destinationStore = stores.ensureChild(destinationDirectory, { bootstrap: false })
  const sourceState = sourceStore?.getState()
  const destinationState = destinationStore.getState()
  const liveSession = sourceState?.session.find((candidate) => candidate.id === session.id) ?? session
  const movedSession = { ...liveSession, directory: destinationDirectory } as Session

  if (sourceStore === destinationStore) {
    return movedSession
  }

  const destinationSessionIndex = destinationState.session.findIndex((candidate) => candidate.id === session.id)
  const destinationSessions = [...destinationState.session]
  if (destinationSessionIndex === -1) destinationSessions.push(movedSession)
  else destinationSessions[destinationSessionIndex] = movedSession

  if (!sourceStore || !sourceState) {
    destinationStore.setState({
      session: destinationSessions,
      sessionTotal: destinationSessionIndex === -1
        ? destinationState.sessionTotal + 1
        : destinationState.sessionTotal,
    })
    return movedSession
  }

  const sourceContainsSession = sourceState.session.some((candidate) => candidate.id === session.id)
  const status = moveRecordEntries(sourceState.session_status, destinationState.session_status, [session.id])
  const diffs = moveRecordEntries(sourceState.session_diff, destinationState.session_diff, [session.id])
  const todos = moveRecordEntries(sourceState.todo, destinationState.todo, [session.id])
  const permissions = moveRecordEntries(sourceState.permission, destinationState.permission, [session.id])
  const questions = moveRecordEntries(sourceState.question, destinationState.question, [session.id])
  const messages = moveRecordEntries(sourceState.message, destinationState.message, [session.id])
  const messageIds = sourceState.message[session.id]?.map((message) => message.id) ?? []
  const parts = moveRecordEntries(sourceState.part, destinationState.part, messageIds)

  sourceStore.setState({
    session: sourceState.session.filter((candidate) => candidate.id !== session.id),
    sessionTotal: sourceContainsSession ? Math.max(0, sourceState.sessionTotal - 1) : sourceState.sessionTotal,
    session_status: status.source,
    session_diff: diffs.source,
    todo: todos.source,
    permission: permissions.source,
    question: questions.source,
    message: messages.source,
    part: parts.source,
  })
  destinationStore.setState({
    session: destinationSessions,
    sessionTotal: destinationSessionIndex === -1
      ? destinationState.sessionTotal + 1
      : destinationState.sessionTotal,
    session_status: status.destination,
    session_diff: diffs.destination,
    todo: todos.destination,
    permission: permissions.destination,
    question: questions.destination,
    message: messages.destination,
    part: parts.destination,
  })

  return movedSession
}

/**
 * Move a session's OpenCode location via control-plane, then reconcile live stores.
 * Caller must keep serverId unchanged; only directory changes.
 */
export async function moveSessionToDirectory(
  session: Session,
  sourceDirectory: string,
  destinationDirectory: string,
  moveChanges = true,
): Promise<void> {
  const client = sdkForSession(session.id, sourceDirectory)
  const controlPlane = client.experimental?.controlPlane
  if (!controlPlane?.moveSession) {
    throw new Error("OpenCode control-plane moveSession is unavailable on this server")
  }

  const result = await controlPlane.moveSession({
    sessionID: session.id,
    destination: { directory: destinationDirectory },
    moveChanges,
  })

  if (result && typeof result === "object" && "error" in result && result.error) {
    const status = getSdkResultStatus(result)
    const message = formatSdkError(result.error)
    const error = new Error(`Move session failed${status ? ` (${status})` : ""}: ${message}`) as Error & { status?: number }
    if (status !== undefined) {
      error.status = status
    }
    // Wrapping loses the original error's identity: the transport's
    // "dispatched, outcome unknown" tag, a DOMException abort, a TypeError
    // from fetch. Re-tag the wrapper so `isAmbiguousSendFailure` still
    // classifies it as ambiguous instead of reading it as a definite server
    // rejection — a rolled-back move whose changes actually transferred is
    // how user edits get duplicated or lost.
    throw isAmbiguousSendFailure(result.error) ? markAmbiguousTransportFailure(error) : error
  }

  const status = getSdkResultStatus(result)
  if (status !== undefined && status >= 400) {
    const error = new Error(`Move session failed (${status})`)
    ;(error as Error & { status?: number }).status = status
    throw error
  }

  const moved = reconcileSessionMove(session, sourceDirectory, destinationDirectory)

  registerSessionDirectory(session.id, destinationDirectory)
  useGlobalSessionsStore.getState().upsertSession(moved)
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createSession(
  title?: string,
  directoryOverride?: string | null,
  parentID?: string | null,
  serverId?: string | null,
  options?: { select?: boolean },
  metadata?: Record<string, unknown>,
): Promise<Session | null> {
    if (!directoryOverride) {
      console.error("[session-actions] createSession: directoryOverride is required (no global-directory fallback)")
      return null
    }
    const targetDir = directoryOverride

    let client: OpencodeClient
    let resolvedServerId = serverId ?? null
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      client = getOrRegisterRemoteConnection(serverId).client
    } else if (serverId === DEFAULT_SERVER_ID) {
      const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
      if (defaultConn) {
        client = defaultConn.client
      } else {
        client = sdk()
      }
    } else {
      client = resolveSdkForDirectory(targetDir)
      resolvedServerId = getServerIdForBaseUrl(resolveBaseUrl(targetDir)) ?? DEFAULT_SERVER_ID
    }

    const result = await client.session.create({
      directory: targetDir,
      title,
      parentID: parentID ?? undefined,
      ...(metadata ? { metadata } : {}),
    })
    const session = unwrapSdkData(result, "session.create")

      const sessionDirectory = (session as { directory?: string }).directory ?? directoryOverride ?? null
      if (sessionDirectory) {
        registerSessionDirectory(session.id, sessionDirectory)
      }

      if (resolvedServerId) {
        serverRegistry.indexSession(session.id, resolvedServerId)
      }

      if (sessionDirectory) {
        if (resolvedServerId && resolvedServerId !== DEFAULT_SERVER_ID) {
          const remoteStores = getSyncStoresForServer(resolvedServerId)
          if (remoteStores) {
            upsertSessionSnapshot(remoteStores.ensureChild(sessionDirectory), session)
          }
        } else if (_childStores) {
          upsertSessionSnapshot(_childStores.ensureChild(sessionDirectory), session)
        }
      }

      if (options?.select !== false) {
        useSessionUIStore.getState().setCurrentSession(
          session.id,
          sessionDirectory,
          resolvedServerId ? { serverId: resolvedServerId } : undefined,
        )
      }
      useSessionUIStore.getState().markSessionAsOpenChamberCreated(session.id)
      useGlobalSessionsStore.getState().upsertSession(session)
      return session
}

/** Optimistically remove a session from the child store list. Returns previous list for rollback. */
function optimisticRemoveSession(sessionId: string, directory?: string): Session[] | null {
  const store = getDirectoryStore(directory)
  const current = store.getState()
  const sessions = [...current.session]
  const result = Binary.search(sessions, sessionId, (s) => s.id)
  if (result.found) {
    const snapshot = current.session
    sessions.splice(result.index, 1)
    store.setState({ session: sessions })
    return snapshot
  }
  return null
}

function cleanupDeletedSession(sessionId: string, directory: string): void {
  const chatServerId = serverRegistry.getServerForSession(sessionId)
  if (!optimisticRemoveSession(sessionId, directory) && _childStores) {
    for (const [, store] of _childStores.children.entries()) {
      const current = store.getState()
      const sessions = [...current.session]
      const result = Binary.search(sessions, sessionId, (session) => session.id)
      if (!result.found) continue
      sessions.splice(result.index, 1)
      store.setState({ session: sessions })
      break
    }
  }
  useGlobalSessionsStore.getState().removeSessions([sessionId])
  useSessionUIStore.getState().setWorktreeMetadata(sessionId, null)
  if (isChatDirectoryPath(directory)) {
    void deleteChatDirectory(directory, chatServerId).catch((error) => {
      console.warn("[session-actions] failed to delete managed Chat directory", error)
    })
  }
}

function isSessionNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { status?: unknown; response?: { status?: unknown } }
  return candidate.status === 404 || candidate.response?.status === 404
}

async function cleanupBtwLinksBeforeRemoval(sessionId: string, directory: string): Promise<void> {
  await cleanupBtwBeforeSessionRemoval(sessionId, {
    getSession: async (targetSessionId) => {
      const result = await sdkForSession(targetSessionId, directory).session.get({
        sessionID: targetSessionId,
        directory,
      })
      return result.data ?? null
    },
    patchMetadata: async (targetSessionId, transform) => {
      await patchSessionMetadata(targetSessionId, directory, transform)
    },
    deleteTemporarySession: async (targetSessionId) => {
      try {
        await sdkForSession(targetSessionId, directory).session.delete({
          sessionID: targetSessionId,
          directory,
        })
      } catch (error) {
        if (!isSessionNotFound(error)) throw error
      }
      cleanupDeletedSession(targetSessionId, directory)
    },
  })
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteSession(sessionId: string, _options?: Record<string, unknown>): Promise<boolean> {
  const sessionDirectory = requireSessionDirectory(sessionId, "deleteSession")
  const ui = useSessionUIStore.getState()
  ui.markSessionDeleting(sessionId)

  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    await cleanupBtwLinksBeforeRemoval(sessionId, sessionDirectory)
    await sdkForSession(sessionId, sessionDirectory).session.delete({ sessionID: sessionId, directory: sessionDirectory })
    cleanupDeletedSession(sessionId, sessionDirectory)
    return true
  } catch (error) {
    if (isSessionNotFound(error)) {
      cleanupDeletedSession(sessionId, sessionDirectory)
      return true
    }
    console.error("[session-actions] deleteSession failed", error)
    return false
  } finally {
    useSessionUIStore.getState().unmarkSessionDeleting(sessionId)
  }
}

/** Delete a session specifying which directory it lives in. Used by agent groups for cross-directory deletes. */
export async function deleteSessionInDirectory(sessionId: string, directory: string): Promise<boolean> {
  if (!_childStores) return false
  const ui = useSessionUIStore.getState()
  ui.markSessionDeleting(sessionId)
  if (ui.currentSessionId === sessionId) ui.setCurrentSession(null)
  try {
    await cleanupBtwLinksBeforeRemoval(sessionId, directory)
    await sdkForSession(sessionId, directory).session.delete({ sessionID: sessionId, directory })
    cleanupDeletedSession(sessionId, directory)
    return true
  } catch (error) {
    if (isSessionNotFound(error)) {
      cleanupDeletedSession(sessionId, directory)
      return true
    }
    console.error("[session-actions] deleteSessionInDirectory failed", error)
    return false
  } finally {
    useSessionUIStore.getState().unmarkSessionDeleting(sessionId)
  }
}

export async function archiveSession(sessionId: string, expectedRuntimeKey: string = getRuntimeKey()): Promise<boolean> {
  if (isStaleRuntime(expectedRuntimeKey)) return false
  const sessionDirectory = requireSessionDirectory(sessionId, "archiveSession")
  const ui = useSessionUIStore.getState()
  ui.markSessionDeleting(sessionId)
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    await cleanupBtwLinksBeforeRemoval(sessionId, sessionDirectory)
    const archivedAt = Date.now()
    await sdkForSession(sessionId, sessionDirectory).session.update({ sessionID: sessionId, directory: sessionDirectory, time: { archived: archivedAt } })
    if (isStaleRuntime(expectedRuntimeKey)) return false
    useGlobalSessionsStore.getState().archiveSessions([sessionId], archivedAt)
    optimisticRemoveSession(sessionId, sessionDirectory)
    return true
  } catch (error) {
    console.error("[session-actions] archiveSession failed", error)
    return false
  } finally {
    useSessionUIStore.getState().unmarkSessionDeleting(sessionId)
  }
}

export async function archiveSessions(
  ids: string[],
  options?: ArchiveSessionsOptions,
): Promise<{ archivedIds: string[]; failedIds: string[] }> {
  const archivedIds: string[] = []
  const failedIds: string[] = []
  const expectedRuntimeKey = options?.expectedRuntimeKey ?? getRuntimeKey()
  if (ids.length === 0) return { archivedIds, failedIds }

  const plan = planArchiveBatches(ids)

  for (const [directory, batchIds] of plan.batchesByDirectory) {
    if (isStaleRuntime(expectedRuntimeKey)) {
      failedIds.push(...batchIds)
      continue
    }

    const archivedAt = Date.now()
    registerBulkArchiveEchoes(
      expectedRuntimeKey,
      batchIds.map((id) => ({ id, archivedAt })),
    )
    const result = await requestSessionArchiveBatch(directory, batchIds, archivedAt, resolveBaseUrl(directory))
    if (isStaleRuntime(expectedRuntimeKey)) {
      failedIds.push(...batchIds)
      continue
    }

    if (result.outcome === "archived") {
      releaseBulkArchiveEchoes(expectedRuntimeKey, batchIds)
      registerBulkArchiveEchoes(
        expectedRuntimeKey,
        result.archived.flatMap((session) => (
          session.time?.archived === undefined
            ? []
            : [{ id: session.id, archivedAt: session.time.archived }]
        )),
      )
      commitArchivedSessions(result.archived, directory)
      archivedIds.push(...result.archived.map((session) => session.id))
      failedIds.push(...result.failedIds)
      continue
    }

    // The runtime does not serve the batch route, or its answer could not be
    // trusted. Archiving each session individually is slower but reaches the
    // same state, and re-archiving a session the server already archived writes
    // the same field again.
    console.warn("[session-actions] archive batch unavailable, archiving one by one", result.reason)
    releaseBulkArchiveEchoes(expectedRuntimeKey, batchIds)
    plan.individualIds.push(...batchIds)
  }

  for (const [index, id] of plan.individualIds.entries()) {
    if (isStaleRuntime(expectedRuntimeKey)) {
      failedIds.push(...plan.individualIds.slice(index))
      break
    }
    if (await archiveSession(id, expectedRuntimeKey)) archivedIds.push(id)
    else failedIds.push(id)
  }

  return { archivedIds, failedIds }
}

/**
 * A session whose archive also has to rewrite another session's metadata.
 *
 * Review sessions and btw forks point at a parent that must be unlinked, and a
 * parent with an active btw fork has to delete that fork. Those are
 * read-modify-write pairs on a second session, so they stay on the per-session
 * path instead of the server batch.
 */
function hasLinkedSessionCleanup(session: Session): boolean {
  return isReviewSession(session) || isBtwSession(session) || Boolean(getBtwSessionID(session))
}

/**
 * Split the requested IDs into per-directory server batches and the sessions
 * that must be archived individually.
 *
 * Link classification reads this client's session records rather than
 * refetching each session: those records are kept current by the same
 * `session.updated` events that publish a link created anywhere else, so a
 * fetch per session would buy no authority the store does not already have.
 * A session this client does not hold is classified as individual, which
 * restores the per-session fetch for exactly the cases where the store has
 * nothing to say.
 */
function planArchiveBatches(ids: string[]) {
  const global = useGlobalSessionsStore.getState()
  const knownSessions = new Map<string, Session>()
  for (const session of [...global.activeSessions, ...global.archivedSessions]) {
    knownSessions.set(session.id, session)
  }
  for (const { childStores } of getAllSyncStores()) {
    for (const store of childStores.children.values()) {
      for (const session of store.getState().session) knownSessions.set(session.id, session)
    }
  }
  if (_childStores) {
    for (const store of _childStores.children.values()) {
      for (const session of store.getState().session) knownSessions.set(session.id, session)
    }
  }

  const batchesByDirectory = new Map<string, string[]>()
  const individualIds: string[] = []

  for (const id of ids) {
    const session = knownSessions.get(id)
    const directory = session
      ? resolveGlobalSessionDirectory(session) ?? getSessionDirectory(id)
      : undefined
    if (!session || !directory || hasLinkedSessionCleanup(session)) {
      individualIds.push(id)
      continue
    }
    const batch = batchesByDirectory.get(directory)
    if (batch) batch.push(id)
    else batchesByDirectory.set(directory, [id])
  }

  return { batchesByDirectory, individualIds }
}

/**
 * Remove a batch of server-confirmed sessions from every live child store.
 *
 * Each affected store is written once for the whole batch. Removing the
 * sessions one at a time notified every subscriber — and therefore re-rendered
 * the sidebar — once per session, which is what made archiving a worktree's
 * sessions block the main thread for seconds.
 */
function removeSessionsFromLiveStores(sessionIds: Iterable<string>, preferredDirectory?: string): string[] {
  const ids = new Set(sessionIds)
  if (ids.size === 0) return []

  const visited = new Set<string>()
  const managers: Array<ChildStoreManager | undefined> = []

  if (preferredDirectory) {
    const baseUrl = resolveBaseUrl(preferredDirectory)
    const preferredServerId = baseUrl ? getServerIdForBaseUrl(baseUrl) : DEFAULT_SERVER_ID
    if (preferredServerId && preferredServerId !== DEFAULT_SERVER_ID) {
      managers.push(getSyncStoresForServer(preferredServerId))
    }
  }
  managers.push(_childStores ?? undefined)
  for (const { childStores } of getAllSyncStores()) managers.push(childStores)

  const writtenDirectories: string[] = []

  for (const manager of managers) {
    if (!manager) continue
    const candidates: Array<[string, ReturnType<ChildStoreManager["ensureChild"]>]> = []

    if (preferredDirectory) {
      const preferredStore = manager.getChild(preferredDirectory)
      if (preferredStore) {
        candidates.push([preferredDirectory, preferredStore])
        visited.add(normalizeDirectoryKey(preferredDirectory))
      }
    }

    for (const entry of manager.children.entries()) {
      const key = normalizeDirectoryKey(entry[0])
      if (visited.has(key)) continue
      candidates.push(entry)
      visited.add(key)
    }

    for (const [storeDirectory, store] of candidates) {
      const current = store.getState()
      const removed = current.session.filter((session) => ids.has(session.id)).map((session) => session.id)
      if (removed.length === 0) continue

      writtenDirectories.push(normalizeDirectoryKey(storeDirectory))
      store.setState({
        session: current.session.filter((session) => !ids.has(session.id)),
      })
    }
  }

  return writtenDirectories
}

/**
 * Reconcile a server-confirmed archive batch with one write per store.
 *
 * This mirrors what `archiveSession` does for a single session — drop it from
 * the live directory stores, move it to the archived bucket, and clear it if
 * it was open — with the per-session store notifications collapsed into one.
 */
function commitArchivedSessions(sessions: Session[], directory: string): void {
  if (sessions.length === 0) return

  const ids = sessions.map((session) => session.id)
  removeSessionsFromLiveStores(ids, directory)

  const global = useGlobalSessionsStore.getState()
  for (const session of sessions) global.upsertSession(session)

  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId && ids.includes(ui.currentSessionId)) ui.setCurrentSession(null)
}

/**
 * Sentinel written to `time.archived` when restoring a session.
 *
 * The OpenCode server has no HTTP path to clear `time.archived` back to NULL:
 * `session.update` only applies the field when the payload carries a finite
 * number, so omitting the key is a no-op and `null` is silently ignored.
 * Writing `0` is the only value that makes every reader treat the session as
 * active again: the UI, the event reducer, and the OpenCode app/TUI all
 * classify archive state by truthiness of `time.archived`, and `0` is falsy.
 */
const UNARCHIVED_TIMESTAMP = 0

/**
 * Restore one archived session back to the active list.
 *
 * Same contract as `archiveSession`: waits for server confirmation before
 * reconciling stores, and rejects stale runtimes so a response produced by a
 * previous runtime cannot mutate the current runtime's state. Fails loudly
 * (returns false) when the server keeps the session archived instead of
 * toasting a successful no-op.
 */
export async function unarchiveSession(
  sessionId: string,
  expectedRuntimeKey: string = getRuntimeKey(),
): Promise<boolean> {
  if (isStaleRuntime(expectedRuntimeKey)) return false
  const sessionDirectory = requireSessionDirectory(sessionId, "unarchiveSession")
  try {
    const result = await sdkForSession(sessionId, sessionDirectory).session.update({
      sessionID: sessionId,
      directory: sessionDirectory,
      time: { archived: UNARCHIVED_TIMESTAMP },
    })
    if (isStaleRuntime(expectedRuntimeKey)) return false
    const restored = result.data
    if (!restored) {
      throw new Error("session.update failed: server did not return the restored session")
    }
    if (restored.time?.archived) {
      throw new Error("session.update failed: server kept the session archived")
    }
    useGlobalSessionsStore.getState().upsertSession(restored)
    registerSessionDirectory(sessionId, sessionDirectory)
    return true
  } catch (error) {
    console.error("[session-actions] unarchiveSession failed", error)
    return false
  }
}

export type UnarchiveSessionsOptions = {
  /**
   * Runtime key captured when the batch was confirmed. When supplied, the batch
   * stops as soon as the active runtime differs.
   */
  expectedRuntimeKey?: string
}

/**
 * Restore several archived sessions sequentially, preserving partial results.
 *
 * One failed session never blocks or erases the others: it is reported in
 * `failedIds` while the remaining IDs are still attempted. When
 * `expectedRuntimeKey` is supplied and the runtime changes mid-batch, the
 * already-confirmed sessions stay in `restoredIds` and every unconfirmed ID is
 * reported in `failedIds`.
 */
export async function unarchiveSessions(
  ids: string[],
  options?: UnarchiveSessionsOptions,
): Promise<{ restoredIds: string[]; failedIds: string[] }> {
  const restoredIds: string[] = []
  const failedIds: string[] = []
  const expectedRuntimeKey = options?.expectedRuntimeKey ?? getRuntimeKey()

  for (const [index, id] of ids.entries()) {
    if (isStaleRuntime(expectedRuntimeKey)) {
      failedIds.push(...ids.slice(index))
      break
    }
    if (await unarchiveSession(id, expectedRuntimeKey)) restoredIds.push(id)
    else failedIds.push(id)
  }

  return { restoredIds, failedIds }
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "updateSessionTitle")
  const result = await sdkForSession(sessionId, sessionDirectory).session.update({ sessionID: sessionId, directory: sessionDirectory, title })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
}

export async function patchSessionMetadata(
  sessionId: string,
  directory: string,
  transform: (metadata: Record<string, unknown>) => Record<string, unknown>,
  expectedRuntimeKey?: string,
): Promise<Session | null> {
  if (isStaleRuntime(expectedRuntimeKey)) throw new Error("runtime changed")
  const sessionDirectory = directory || requireSessionDirectory(sessionId, "patchSessionMetadata")
  const sdk = sdkForSession(sessionId, sessionDirectory)
  const current = await sdk.session.get({ sessionID: sessionId, directory: sessionDirectory })
  if (isStaleRuntime(expectedRuntimeKey)) throw new Error("runtime changed")
  const existingMetadata = (current.data && typeof (current.data as Session & { metadata?: unknown }).metadata === 'object' && (current.data as Session & { metadata?: unknown }).metadata !== null && !Array.isArray((current.data as Session & { metadata?: unknown }).metadata))
    ? (current.data as Session & { metadata?: Record<string, unknown> }).metadata as Record<string, unknown>
    : {}
  const nextMetadata = transform(existingMetadata)
  const result = await sdk.session.update({ sessionID: sessionId, directory: sessionDirectory, metadata: nextMetadata })
  if (isStaleRuntime(expectedRuntimeKey)) throw new Error("runtime changed")
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
  return result.data ?? null
}

export async function setLinkedIssue(
  sessionId: string,
  directory: string | null | undefined,
  issue: LinkedIssue,
  linked: boolean,
): Promise<Session | null> {
  const resolvedDirectory = directory ?? getSessionDirectory(sessionId)
  if (!resolvedDirectory) return null
  return patchSessionMetadata(sessionId, resolvedDirectory, (metadata) =>
    withLinkedIssue(metadata, issue, linked))
}

export async function setContextObligatoryMessage(
  sessionId: string,
  directory: string,
  message: ContextObligatoryMessage,
  pinned: boolean,
): Promise<Session | null> {
  const sessionDirectory = typeof directory === "string" ? directory.trim() : ""
  if (!sessionDirectory) {
    throw new Error(`setContextObligatoryMessage: directory for session ${sessionId} is not available`)
  }
  return patchSessionMetadata(sessionId, sessionDirectory, (metadata) =>
    withContextObligatoryMessage(metadata, message, pinned))
}

export async function summarizeSession(
  sessionId: string,
  input: { modelID: string; providerID: string },
): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "summarizeSession")
  await waitForConnectionOrThrow(serverRegistry.getServerForSession(sessionId))
  unwrapSdkData(
    await sdkForSession(sessionId, sessionDirectory).session.summarize({
      sessionID: sessionId,
      directory: sessionDirectory,
      modelID: input.modelID,
      providerID: input.providerID,
    }),
    "session.summarize",
  )
}

export async function shareSession(sessionId: string): Promise<Session | null> {
  const sessionDirectory = requireSessionDirectory(sessionId, "shareSession")
  const result = await sdkForSession(sessionId, sessionDirectory).session.share({ sessionID: sessionId, directory: sessionDirectory })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
  return result.data ?? null
}

export async function unshareSession(sessionId: string): Promise<Session | null> {
  const sessionDirectory = requireSessionDirectory(sessionId, "unshareSession")
  const result = await sdkForSession(sessionId, sessionDirectory).session.unshare({ sessionID: sessionId, directory: sessionDirectory })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
  return result.data ?? null
}

// ---------------------------------------------------------------------------
// Optimistic message send — insert user message before API call, rollback on error
// ---------------------------------------------------------------------------

// ID generator matching OpenCode's Identifier.ascending format.
// Uses BigInt(timestamp) * 0x1000 + counter, encoded as 6 hex bytes + random base62.
// This ensures client-generated IDs sort correctly with server-generated ones.
let lastIdTimestamp = 0
let idCounter = 0

function ascendingId(prefix: string): string {
  const now = Date.now()
  if (now !== lastIdTimestamp) {
    lastIdTimestamp = now
    idCounter = 0
  }
  idCounter += 1

  const value = BigInt(now) * BigInt(0x1000) + BigInt(idCounter)
  const bytes = new Uint8Array(6)
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((value >> BigInt(40 - 8 * i)) & BigInt(0xff))
  }

  let hex = ""
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0")
  }

  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  let rand = ""
  for (let i = 0; i < 14; i++) {
    rand += chars[Math.floor(Math.random() * 62)]
  }

  return `${prefix}_${hex}${rand}`
}

/**
 * Wraps an async send operation with optimistic user-message insertion.
 * Uses useSync()'s optimistic infrastructure — message + parts are inserted
 * into the store AND registered in the shadow Map. mergeOptimisticPage
 * handles deduplication when the server echoes back the real message.
 */
export async function optimisticSend(input: {
  sessionId: string
  content: string
  providerID: string
  modelID: string
  agent?: string
  files?: Array<{ type: "file"; mime: string; url: string; filename: string }>
  directory?: string | null
  serverId?: string | null
  deliveryMode?: SendDeliveryMode
  buildOptimisticParts?: (input: BuildOptimisticPartsInput) => Part[]
  /** The actual API call — receives the optimistic messageID so the server can use the same ID */
  send: (messageID: string) => Promise<void>
}): Promise<void> {
  if (!_optimisticAdd || !_optimisticRemove) {
    throw new Error("Optimistic refs not set — is useSync() mounted?")
  }

  const store = storeForSession(input.sessionId, input.directory, input.serverId)
  if (isSessionBlockedForSend(store, input.sessionId)) {
    await resolveBlockedSessionBeforeSend(input)
  }
  const targetDirectory = input.directory
    ? normalizeDirectoryKey(input.directory)
    : getSessionDirectory(input.sessionId)
  const targetServerId = input.serverId ?? serverRegistry.getServerForSession(input.sessionId)
  const stateBeforeSend = store.getState()
  const sessionBeforeSend = stateBeforeSend.session.find((session) => session.id === input.sessionId)
  const revertMessageID = sessionBeforeSend?.revert?.messageID
  const sessionMessages = stateBeforeSend.message[input.sessionId] ?? []
  const revertedMessages = messagesFrom(sessionMessages, revertMessageID)
  const revertedParts = new Map(
    revertedMessages.map((message) => [message.id, stateBeforeSend.part[message.id] ?? []] as const),
  )

  if (revertMessageID) {
    const session = stateBeforeSend.session.map((candidate) => (
      candidate.id === input.sessionId ? { ...candidate, revert: undefined } as Session : candidate
    ))
    const message = {
      ...stateBeforeSend.message,
      [input.sessionId]: messagesBefore(sessionMessages, revertMessageID),
    }
    const part = { ...stateBeforeSend.part }
    for (const revertedMessage of revertedMessages) delete part[revertedMessage.id]
    store.setState({ session, message, part })
  }

  const confirmRevertedShadows = () => {
    for (const revertedMessage of revertedMessages) {
      _optimisticConfirm?.({
        sessionID: input.sessionId,
        messageID: revertedMessage.id,
        directory: targetDirectory,
        serverId: targetServerId,
      })
    }
  }

  const messageID = ascendingId("msg")
  const textPartId = ascendingId("prt")

  const optimisticParts: Part[] = input.buildOptimisticParts
    ? input.buildOptimisticParts({
      messageID,
      createPartID: () => ascendingId("prt"),
    })
    : [
      { id: textPartId, type: "text", text: input.content } as Part,
    ]
  if (!input.buildOptimisticParts && input.files) {
    for (const f of input.files) {
      optimisticParts.push({ id: ascendingId("prt"), type: "file", mime: f.mime, url: f.url, filename: f.filename } as Part)
    }
  }

  const stateBeforeOptimistic = store.getState()
  const parentAssistantMessage = input.deliveryMode === "steer"
    ? [...(stateBeforeOptimistic.message[input.sessionId] ?? [])].reverse().find((message) => message.role === "assistant")
    : undefined
  const steerParentID = parentAssistantMessage?.id ?? ""

  const optimisticMessage = {
    id: messageID,
    role: "user" as const,
    sessionID: input.sessionId,
    parentID: steerParentID,
    modelID: input.modelID,
    providerID: input.providerID,
    system: "",
    agent: input.agent ?? "",
    model: `${input.providerID}/${input.modelID}`,
    metadata: (input.deliveryMode === "steer"
      ? { openchamberLiveSteer: true, openchamberDeliveryMode: "steer" }
      : {}) as Record<string, unknown>,
    time: { created: Date.now(), completed: 0 },
  } as unknown as Message

  if (input.deliveryMode === "steer") {
    persistSteerSideChannelMessage({
      sessionID: input.sessionId,
      messageID,
      parentID: steerParentID,
      text: input.content,
      createdAt: optimisticMessage.time.created,
      providerID: input.providerID,
      modelID: input.modelID,
      agent: input.agent ?? "",
    })
  }

  // Insert into store + register in shadow Map (for mergeOptimisticPage cleanup)
  _optimisticAdd({
    sessionID: input.sessionId,
    message: optimisticMessage,
    parts: optimisticParts,
    directory: input.directory,
    serverId: input.serverId,
  })

  // Set busy status
  const current = store.getState()
  store.setState({
    session_status: {
      ...current.session_status,
      [input.sessionId]: { type: "busy" as const },
    },
  })

  try {
    await waitForConnectionOrThrow(targetServerId)

    await input.send(messageID)
    confirmRevertedShadows()
  } catch (error) {
    const acceptedRecords = isAmbiguousSendFailure(error) && targetDirectory
      ? await fetchRecentSendConfirmationRecords(input.sessionId, messageID, targetDirectory, targetServerId)
      : null

    if (acceptedRecords) {
      materializeConfirmedSendRecords(store, input.sessionId, messageID, acceptedRecords)
      _optimisticConfirm?.({
        sessionID: input.sessionId,
        messageID,
        directory: targetDirectory,
        serverId: targetServerId,
      })
      confirmRevertedShadows()
      return
    }

    const ambiguousFailure = isAmbiguousSendFailure(error)
    recordSendFailure({
      sessionId: input.sessionId,
      messageId: messageID,
      directory: targetDirectory ?? null,
      status: getErrorStatus(error),
      ambiguous: ambiguousFailure,
      confirmationChecked: ambiguousFailure,
      reason: error instanceof Error ? error.message : String(error),
    })

    // Rollback via optimistic infrastructure
    _optimisticRemove({
      sessionID: input.sessionId,
      messageID,
      directory: input.directory,
      serverId: input.serverId,
    })
    const s = store.getState()
    let session = s.session
    let message = s.message
    let part = s.part
    if (revertMessageID) {
      session = s.session.map((candidate) => (
        candidate.id === input.sessionId ? { ...candidate, revert: sessionBeforeSend?.revert } as Session : candidate
      ))
      message = {
        ...s.message,
        [input.sessionId]: sortMessagesChronologically([...(s.message[input.sessionId] ?? []), ...revertedMessages]),
      }
      part = { ...s.part }
      for (const [revertedMessageId, parts] of revertedParts) {
        part[revertedMessageId] = parts
      }
    }
    store.setState({
      session,
      message,
      part,
      session_status: {
        ...s.session_status,
        [input.sessionId]: { type: "idle" as const },
      },
    })
    throw error
  }
}

async function fetchRecentSendConfirmationRecords(
  sessionId: string,
  messageID: string,
  directory: string,
  serverId?: string | null,
): Promise<Array<{ info: Message; parts?: Part[] }> | null> {
  const client = resolveSdkForDirectory(directory, sessionId, serverId ?? undefined)
  for (let attempt = 0; attempt < SEND_CONFIRMATION_REFETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(SEND_CONFIRMATION_REFETCH_RETRY_MS)
    const outcome = await client.session.messages({
      sessionID: sessionId,
      directory,
      limit: SEND_CONFIRMATION_REFETCH_LIMIT,
    }).then(
      (result) => ({ kind: "success" as const, result }),
      () => ({ kind: "failure" as const }),
    )
    if (outcome.kind === "failure" || outcome.result.error || !outcome.result.data) {
      continue
    }
    const records = outcome.result.data.filter((record) => Boolean(record?.info?.id))
    if (records.some((record) => record.info.id === messageID)) {
      return records
    }
  }
  return null
}

function materializeConfirmedSendRecords(
  store: ReturnType<ChildStoreManager["ensureChild"]>,
  sessionId: string,
  messageID: string,
  records: Array<{ info: Message; parts?: Part[] }>,
): void {
  store.setState((state) => {
    const message = { ...state.message }
    const part = { ...state.part }
    const currentMessages = message[sessionId]
    if (currentMessages) {
      message[sessionId] = currentMessages.filter((entry) => entry.id !== messageID)
    }
    delete part[messageID]

    const materialized = materializeSessionSnapshots(
      { ...state, message, part },
      sessionId,
      records.map((record) => ({
        info: stripMessageDiffSnapshots(record.info),
        parts: record.parts ?? [],
      })),
      { skipPartTypes: MESSAGE_REFETCH_SKIP_PARTS },
    )
    return { message: materialized.message, part: materialized.part }
  })
}

export function materializeReturnedMessage(input: {
  sessionId: string
  record: { info: Message; parts?: Part[] }
  directory?: string | null
  serverId?: string | null
  setIdle?: boolean
}): void {
  const store = storeForSession(input.sessionId, input.directory, input.serverId)
  const current = store.getState()
  const materialized = materializeSessionSnapshots(
    current,
    input.sessionId,
    [{
      info: stripMessageDiffSnapshots(input.record.info),
      parts: input.record.parts ?? [],
    }],
    { skipPartTypes: MESSAGE_REFETCH_SKIP_PARTS },
  )

  const patch: Partial<typeof current> = {}
  if (materialized.messagesChanged) {
    patch.message = materialized.message
  }
  if (materialized.partsChanged) {
    patch.part = materialized.part
  }
  if (input.setIdle) {
    patch.session_status = {
      ...current.session_status,
      [input.sessionId]: { type: "idle" as const },
    }
  }

  if (Object.keys(patch).length > 0) {
    store.setState(patch)
  }
}

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export async function abortCurrentOperation(sessionId: string): Promise<boolean> {
  console.info("[session-actions] abort: start", { sessionId })

  if (!sessionId) {
    console.error("[session-actions] abort: FAILED — no session id")
    return false
  }

  // Fail closed: abort must target the session's own directory, never the
  // active UI directory fallback (cross-project mis-route risk).
  let sessionDirectory: string
  try {
    sessionDirectory = requireSessionDirectory(sessionId, "abortCurrentOperation")
  } catch (err) {
    console.error("[session-actions] abort: FAILED — no session directory", {
      sessionId,
      error: String(err),
    })
    return false
  }

  const directories = new Set<string>([sessionDirectory])

  console.info("[session-actions] abort: directories resolved", {
    sessionId,
    sessionDirectory,
    candidates: [...directories],
    count: directories.size,
  })

  let client: OpencodeClient
  try {
    client = sdkForSession(sessionId, sessionDirectory)
  } catch (error) {
    console.error("[session-actions] abort: FAILED — no client", { sessionId, error: String(error) })
    return false
  }

  const t0 = Date.now()
  const results: Array<{ directory: string; ok: boolean; error?: string; ms: number }> = []
  const abortPromises = [...directories].map(async (dir) => {
    const callStart = Date.now()
    try {
      const result = await client.session.abort({ sessionID: sessionId, directory: dir })
      const aborted = unwrapSdkData(result, "session.abort")
      if (aborted !== true) {
        results.push({ directory: dir, ok: false, error: "session.abort returned false", ms: Date.now() - callStart })
        return
      }
      results.push({ directory: dir, ok: true, ms: Date.now() - callStart })
    } catch (error) {
      results.push({ directory: dir, ok: false, error: String(error), ms: Date.now() - callStart })
    }
  })
  await Promise.all(abortPromises)

  const elapsed = Date.now() - t0
  for (const r of results) {
    if (r.ok) {
      console.info("[session-actions] abort: sent ok", {
        sessionId,
        directory: r.directory,
        ms: r.ms,
      })
    } else {
      console.error("[session-actions] abort: FAILED", {
        sessionId,
        directory: r.directory,
        error: r.error,
        ms: r.ms,
      })
    }
  }

  const sent = results.filter(r => r.ok).length
  console.info("[session-actions] abort: done", {
    sessionId,
    totalMs: elapsed,
    sent,
    failed: results.filter(r => !r.ok).length,
    directories: results.map(r => r.directory),
  })

  return sent > 0
}

// ---------------------------------------------------------------------------
// Continue interrupted message
// ---------------------------------------------------------------------------

export async function continueInterruptedMessage(
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const directory = useSessionUIStore.getState().getDirectoryForSession(sessionId) ?? undefined

  const remoteBase = resolveBaseUrlForSession(sessionId, directory, undefined)
  const base = (remoteBase ?? '/api').replace(/\/+$/, '')
  const path = `/session/${encodeURIComponent(sessionId)}/message/${encodeURIComponent(messageId)}/continue`
  const query = directory ? `?directory=${encodeURIComponent(directory)}` : ''
  const url = `${base}${path}${query}`

  const response = await runtimeFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
  })

  if (!response.ok) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {
      // ignore
    }
    const suffix = detail && detail.trim().length > 0 ? `: ${detail.trim()}` : ''
    throw new Error(`Failed to continue message (${response.status})${suffix}`)
  }

  return true
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function respondToPermission(
  sessionId: string,
  requestId: string,
  response: "once" | "always" | "reject",
  target?: BlockingRequestTarget,
): Promise<void> {
  const serverId = target?.serverId ?? serverRegistry.getServerForSession(sessionId)
  await waitForConnectionOrThrow(serverId)
  const directory = target?.directory?.trim()
    || requireBlockingRequestDirectory("permission", sessionId, requestId)
  const client = target?.directory
    ? resolveSdkForDirectory(directory, sessionId, serverId)
    : undefined
  await sendPermissionResponse(sessionId, requestId, response, directory, "Permission reply failed", client)
}

export async function dismissPermission(
  sessionId: string,
  requestId: string,
): Promise<void> {
  await waitForConnectionOrThrow(serverRegistry.getServerForSession(sessionId))
  const directory = requireBlockingRequestDirectory("permission", sessionId, requestId)
  await sendPermissionResponse(sessionId, requestId, "reject", directory, "Permission dismissal failed")
}

type PermissionDismissalTarget = {
  readonly sessionId: string
  readonly requestId: string
  readonly directory: string
  readonly serverId: string
  readonly permission: PermissionRequest
  readonly stores: ChildStoreManager
}

function collectPermissionDismissalTargets(sessionId: string): PermissionDismissalTarget[] {
  const indexedServerId = serverRegistry.getServerForSession(sessionId)
  const managersByServer = new Map<string, Set<ChildStoreManager>>()
  const addManager = (serverId: string, stores: ChildStoreManager | null | undefined) => {
    if (!stores) return
    const managers = managersByServer.get(serverId) ?? new Set<ChildStoreManager>()
    managers.add(stores)
    managersByServer.set(serverId, managers)
  }

  if (indexedServerId) {
    if (indexedServerId === DEFAULT_SERVER_ID) addManager(DEFAULT_SERVER_ID, _childStores)
    addManager(indexedServerId, getSyncStoresForServer(indexedServerId))
  } else {
    addManager(DEFAULT_SERVER_ID, _childStores)
    for (const entry of getAllSyncStores()) addManager(entry.serverId, entry.childStores)
  }

  const targets: PermissionDismissalTarget[] = []
  const seen = new Set<string>()
  for (const [serverId, managers] of managersByServer) {
    const sessionsById = new Map<string, Session>()
    for (const stores of managers) {
      for (const store of stores.children.values()) {
        for (const session of store.getState().session) sessionsById.set(session.id, session)
      }
    }
    const subtreeIds = computeSessionSubtreeIds([...sessionsById.values()], sessionId)

    for (const stores of managers) {
      for (const [directory, store] of stores.children) {
        const permissionsBySession = store.getState().permission
        for (const scopedSessionId of subtreeIds) {
          for (const request of permissionsBySession[scopedSessionId] ?? []) {
            const key = `${serverId}\0${directory}\0${scopedSessionId}\0${request.id}`
            if (seen.has(key)) continue
            seen.add(key)
            targets.push({
              sessionId: scopedSessionId,
              requestId: request.id,
              directory,
              serverId,
              permission: request,
              stores,
            })
          }
        }
      }
    }
  }
  return targets
}

export async function dismissOpenPermissionsForSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false
  const targets = collectPermissionDismissalTargets(sessionId)
  if (targets.length === 0) return false

  for (const target of targets) {
    removePermissionFromStores(target.stores, target.sessionId, target.requestId)
  }

  await Promise.all(targets.map(async (target) => {
    try {
      await respondToPermission(target.sessionId, target.requestId, "reject", {
        directory: target.directory,
        serverId: target.serverId,
      })
    } catch (error) {
      console.error("[session-actions] Failed to dismiss open permission on send:", error)
      const store = target.stores.getChild(target.directory)
      if (store) {
        const state = store.getState()
        const current = state.permission[target.sessionId] ?? []
        if (!current.some((permission) => permission.id === target.requestId)) {
          store.setState({
            permission: {
              ...state.permission,
              [target.sessionId]: [...current, target.permission],
            },
          })
        }
      }
    }
  }))
  return true
}

async function sendPermissionResponse(
  sessionId: string,
  requestId: string,
  response: "once" | "always" | "reject",
  directory: string,
  failureMessage: string,
  clientOverride?: OpencodeClient,
): Promise<void> {
  const client = clientOverride ?? getRequestReplyClient("permission", sessionId, requestId)
  const directoryParam = directory ? { directory } : {}

  // Some OpenCode servers still expose only the session-scoped permission
  // response route. Prefer it when we have the authoritative session ID.
  const sessionScopedResult = await client.permission.respond({
    sessionID: sessionId,
    permissionID: requestId,
    response,
    ...directoryParam,
  })
  if (hasSuccessfulSdkResult(sessionScopedResult)) {
    return
  }

  if (getSdkResultStatus(sessionScopedResult) === 404) {
    const requestScopedResult = await client.permission.reply({
      requestID: requestId,
      reply: response,
      ...directoryParam,
    })
    if (hasSuccessfulSdkResult(requestScopedResult)) {
      return
    }
  }

  throw new Error(failureMessage)
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function respondToQuestion(
  sessionId: string,
  requestId: string,
  answers: string[] | string[][],
  directoryHint?: string,
): Promise<void> {
  const serverId = resolveBlockingRequestServerId(sessionId, directoryHint)
  await waitForConnectionOrThrow(serverId)
  const directory = directoryHint ?? requireBlockingRequestDirectory("question", sessionId, requestId)
  const client = directoryHint
    ? resolveSdkForDirectory(directoryHint, sessionId, serverId)
    : getRequestReplyClient("question", sessionId, requestId)
  const result = await client.question.reply({
    requestID: requestId,
    answers: answers as Array<Array<string>>,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question reply failed")
  }
  optimisticRemoveQuestion(sessionId, requestId)
}

export async function rejectQuestion(
  sessionId: string,
  requestId: string,
  directoryHint?: string | BlockingRequestTarget,
): Promise<void> {
  const target = typeof directoryHint === "string" ? { directory: directoryHint } : directoryHint
  const serverId = target?.serverId ?? resolveBlockingRequestServerId(sessionId, target?.directory)
  await waitForConnectionOrThrow(serverId)
  const directory = target?.directory?.trim() || requireBlockingRequestDirectory("question", sessionId, requestId)
  const client = target?.directory || target?.serverId
    ? resolveSdkForDirectory(directory, sessionId, serverId)
    : getRequestReplyClient("question", sessionId, requestId)
  const result = await client.question.reject({
    requestID: requestId,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question rejection failed")
  }
  optimisticRemoveQuestion(sessionId, requestId)
}

type QuestionDismissalTarget = {
  readonly sessionId: string
  readonly requestId: string
  readonly directory: string
  readonly serverId: string
  readonly question: QuestionRequest
  readonly stores: ChildStoreManager
}

function computeSessionSubtreeIds(sessions: Session[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const children = childrenByParent.get(session.parentID) ?? []
    children.push(session.id)
    childrenByParent.set(session.parentID, children)
  }

  const ids = new Set<string>([rootId])
  const pending = [rootId]
  for (const sessionId of pending) {
    for (const childId of childrenByParent.get(sessionId) ?? []) {
      if (ids.has(childId)) continue
      ids.add(childId)
      pending.push(childId)
    }
  }
  return ids
}

function collectQuestionDismissalTargets(sessionId: string): QuestionDismissalTarget[] {
  const indexedServerId = serverRegistry.getServerForSession(sessionId)
  const managersByServer = new Map<string, Set<ChildStoreManager>>()
  const addManager = (serverId: string, stores: ChildStoreManager | null | undefined) => {
    if (!stores) return
    const managers = managersByServer.get(serverId) ?? new Set<ChildStoreManager>()
    managers.add(stores)
    managersByServer.set(serverId, managers)
  }

  if (indexedServerId) {
    if (indexedServerId === DEFAULT_SERVER_ID) addManager(DEFAULT_SERVER_ID, _childStores)
    addManager(indexedServerId, getSyncStoresForServer(indexedServerId))
  } else {
    addManager(DEFAULT_SERVER_ID, _childStores)
    for (const entry of getAllSyncStores()) addManager(entry.serverId, entry.childStores)
  }

  const targets: QuestionDismissalTarget[] = []
  const seen = new Set<string>()
  for (const [serverId, managers] of managersByServer) {
    const sessionsById = new Map<string, Session>()
    for (const stores of managers) {
      for (const store of stores.children.values()) {
        for (const session of store.getState().session) sessionsById.set(session.id, session)
      }
    }
    const subtreeIds = computeSessionSubtreeIds([...sessionsById.values()], sessionId)

    for (const stores of managers) {
      for (const [directory, store] of stores.children) {
        const questionsBySession = store.getState().question
        for (const scopedSessionId of subtreeIds) {
          for (const request of questionsBySession[scopedSessionId] ?? []) {
            const key = `${serverId}\0${directory}\0${scopedSessionId}\0${request.id}`
            if (seen.has(key)) continue
            seen.add(key)
            targets.push({
              sessionId: scopedSessionId,
              requestId: request.id,
              directory,
              serverId,
              question: request,
              stores,
            })
          }
        }
      }
    }
  }
  return targets
}

export async function dismissOpenQuestionsForSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false
  const targets = collectQuestionDismissalTargets(sessionId)
  if (targets.length === 0) return false

  for (const target of targets) {
    removeQuestionFromStores(target.stores, target.sessionId, target.requestId)
  }

  await Promise.all(targets.map(async (target) => {
    try {
      await rejectQuestion(target.sessionId, target.requestId, {
        directory: target.directory,
        serverId: target.serverId,
      })
    } catch (error) {
      console.error("[session-actions] Failed to dismiss open question on send:", error)
      const store = target.stores.getChild(target.directory)
      if (store) {
        const state = store.getState()
        const current = state.question[target.sessionId] ?? []
        if (!current.some((question) => question.id === target.requestId)) {
          store.setState({
            question: {
              ...state.question,
              [target.sessionId]: [...current, target.question],
            },
          })
        }
      }
    }
  }))
  return true
}

// ---------------------------------------------------------------------------
// Message history
// ---------------------------------------------------------------------------

/**
 * Extract text content from a user message's non-synthetic text parts.
 * Synthetic parts (system-added context) are filtered out.
 */
function extractUserMessageText(parts: Part[]): string {
  const textParts = parts.filter((p) => p.type === "text" && !isSyntheticPart(p))
  return textParts
    .map((p) => ((p as Record<string, unknown>).text as string) || ((p as Record<string, unknown>).content as string) || "")
    .join("\n")
    .trim()
}

function restoreFilePartsToInput(sessionId: string, fileParts: Array<Record<string, unknown>>): void {
  const input = useInputStore.getState()
  // Ensure restored attachments land on the target session bucket even if the
  // visible composer is briefly on another key during the switch.
  input.setAttachmentSessionKey(sessionId)
  input.clearAttachedFiles()
  for (const filePart of fileParts) {
    const url = typeof filePart.url === "string" ? filePart.url : ""
    const mime = typeof filePart.mime === "string" ? filePart.mime : "application/octet-stream"
    const filename = typeof filePart.filename === "string" ? filePart.filename : "attachment"
    if (url) {
      useInputStore.getState().addRestoredAttachment({ url, mimeType: mime, filename })
    }
  }
}

/**
 * Revert to a specific user message.
 *
 * 1. Abort if session is busy
 * 2. Extract text + file attachments from the target message for input restoration
 * 3. Optimistically set revert marker; keep messages/parts for restore UI
 * 4. Call SDK session.revert() and merge returned session
 * 5. Populate pendingInputText and attachedFiles so the reverted message's
 *    text and images reappear in the input and can be re-sent
 */
export async function revertToMessage(sessionId: string, messageId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "revertToMessage")
  const store = storeForSession(sessionId)
  const state = store.getState()

  // Abort if busy before mutating session state
  const status = state.session_status[sessionId]
  if (status && status.type !== "idle") {
    try {
      await sdkForSession(sessionId, sessionDirectory).session.abort({ sessionID: sessionId, directory: sessionDirectory })
    } catch {
      // ignore abort errors
    }
  }

  // Extract text + file attachments from the target user message before it is hidden.
  const messages = state.message[sessionId] ?? []
  const targetMsg = messages.find((m) => m.id === messageId)
  const targetParts = targetMsg && targetMsg.role === "user"
    ? (state.part[messageId] ?? [])
    : []
  const messageText = extractUserMessageText(targetParts)
  const submittedFileParts = targetParts.filter((p) => p.type === "file" && !isSyntheticPart(p)) as Array<Record<string, unknown>>

  // Optimistically set only the marker. The visible timeline is derived from
  // session.revert so the full message range remains available for restore/fork.
  const prevRevert = (() => {
    const s = state.session.find((s) => s.id === sessionId)
    return (s as Session & { revert?: unknown })?.revert
  })()
  const sessions = [...state.session]
  const sessionIdx = sessions.findIndex((s) => s.id === sessionId)

  const patch: Record<string, unknown> = {}

  if (sessionIdx >= 0) {
    sessions[sessionIdx] = { ...sessions[sessionIdx], revert: { messageID: messageId } } as Session
    patch.session = sessions
  }

  const prevInputAttachments = [...useInputStore.getState().attachedFiles]
  const prevInputText = useInputStore.getState().pendingInputText
  const prevInputMode = useInputStore.getState().pendingInputMode

  store.setState(patch)

  if (messageText) {
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  } else if (targetParts.length > 0) {
    useInputStore.setState({
      pendingInputText: "",
      pendingInputMode: "replace" as const,
    })
  }

  restoreFilePartsToInput(sessionId, submittedFileParts)

  // Call SDK and merge authoritative result into store
  try {
    const result = await sdkForSession(sessionId, sessionDirectory).session.revert({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
    const revertedSession = unwrapSdkData(result, "session.revert")
    const current = store.getState()
    const updated = [...current.session]
    const idx = updated.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      const returnedRevert = (revertedSession as Session & { revert?: Record<string, unknown> }).revert ?? {}
      updated[idx] = { ...revertedSession, revert: { ...returnedRevert, messageID: messageId } } as Session
      store.setState({ session: updated })
    }
    sessionEvents.requestGitRefresh({ directory: sessionDirectory })
  } catch (err) {
    // Rollback marker and input state.
    const current = store.getState()
    const rollback = [...current.session]
    const idx = rollback.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      rollback[idx] = { ...rollback[idx], revert: prevRevert } as Session
    }
    store.setState({ session: rollback })
    useInputStore.setState({
      pendingInputText: prevInputText,
      pendingInputMode: prevInputMode,
    })
    useInputStore.getState().setAttachedFiles(prevInputAttachments)
    throw err
  }
}

export async function refetchSessionMessages(sessionId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "refetchSessionMessages")
  const store = storeForSession(sessionId)
  const result = await sdkForSession(sessionId, sessionDirectory).session.messages({
    sessionID: sessionId,
    directory: sessionDirectory,
    limit: MESSAGE_REFETCH_LIMIT,
  })
  const records = unwrapMessageRecords(result, "session.messages")
    .filter((record: { info?: { id?: string } }) => !!record?.info?.id)
  if (records.length === 0) return

  store.setState((state) => {
    const materialized = materializeSessionSnapshots(
      state,
      sessionId,
      records.map((record: { info: Message; parts?: Part[] }) => ({
        info: stripMessageDiffSnapshots(record.info),
        parts: record.parts ?? [],
      })),
      { skipPartTypes: MESSAGE_REFETCH_SKIP_PARTS },
    )
    return { message: materialized.message, part: materialized.part }
  })
}

/**
 * Unrevert — restore all previously reverted messages.
 * Restore all previously reverted messages. Aborts if busy, merges result.
 */
export async function unrevertSession(sessionId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "unrevertSession")
  const store = storeForSession(sessionId)
  const state = store.getState()
  const previousMessageCount = state.message[sessionId]?.length ?? 0

  // Abort if busy
  const status = state.session_status[sessionId]
  if (status && status.type !== "idle") {
    try {
      await sdkForSession(sessionId, sessionDirectory).session.abort({ sessionID: sessionId, directory: sessionDirectory })
    } catch {
      // ignore
    }
  }

  const result = await sdkForSession(sessionId, sessionDirectory).session.unrevert({ sessionID: sessionId, directory: sessionDirectory })
  const restoredSession = unwrapSdkData(result, "session.unrevert")
  const current = store.getState()
  const sessions = [...current.session]
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx >= 0) {
    sessions[idx] = restoredSession
    store.setState({ session: sessions })
  }
  for (let attempt = 0; attempt < UNREVERT_REFETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(UNREVERT_REFETCH_RETRY_MS)
    await refetchSessionMessages(sessionId)
    const nextMessageCount = store.getState().message[sessionId]?.length ?? 0
    if (nextMessageCount > previousMessageCount) return
  }
}

/**
 * Fork from a user message.
 *
 * 1. Extract text + file attachments from the message for input restoration
 * 2. Call SDK session.fork()
 * 3. Insert the new session into the child store (so sidebar updates immediately)
 * 4. Switch to new session and populate pending input text + attachedFiles
 */
/**
 * Last assistant provider/model for a session — authoritative for small-model
 * utility calls that must stay on the conversation's subscription.
 */
export function getSessionLastAssistantModel(
  sessionId: string,
): { providerID: string; modelID: string } | null {
  try {
    const store = storeForSession(sessionId)
    const messages = store.getState().message[sessionId]
    if (!messages) return null
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const info = messages[i] as { role?: string; providerID?: string; modelID?: string }
      if (
        info?.role === "assistant"
        && typeof info.providerID === "string"
        && info.providerID
        && typeof info.modelID === "string"
        && info.modelID
      ) {
        return { providerID: info.providerID, modelID: info.modelID }
      }
    }
    return null
  } catch {
    return null
  }
}

export async function forkFromMessage(sessionId: string, messageId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "forkFromMessage")
  const parentServerId = serverRegistry.getServerForSession(sessionId)
  const store = storeForSession(sessionId)
  const state = store.getState()

  const parts = state.part[messageId] ?? []
  const messageText = extractUserMessageText(parts)
  const fileParts = parts.filter((p) => p.type === "file" && !isSyntheticPart(p)) as Array<Record<string, unknown>>

  const result = await sdkForSession(sessionId, sessionDirectory).session.fork({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
  if (!result.data) return

  const forkedSession = result.data
  registerSessionDirectory(forkedSession.id, sessionDirectory)
  if (parentServerId) {
    serverRegistry.indexSession(forkedSession.id, parentServerId)
  }

  // Insert new session into child store so sidebar updates immediately
  const current = store.getState()
  const sessions = [...current.session]
  const searchResult = Binary.search(sessions, forkedSession.id, (s) => s.id)
  if (!searchResult.found) {
    sessions.splice(searchResult.index, 0, forkedSession)
    store.setState({ session: sessions })
  }

  useSessionUIStore.getState().setCurrentSession(forkedSession.id, sessionDirectory, {
    serverId: parentServerId,
  })

  if (messageText) {
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  }

  restoreFilePartsToInput(forkedSession.id, fileParts)
}
