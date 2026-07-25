/**
 * Session actions — SDK-calling operations for session management.
 * Replaces the action methods from the old useSessionStore.
 */

import type { OpencodeClient, Session, Message, Part, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { QuestionRequest } from "@/types/question"
import { Binary } from "./binary"
import { useSessionUIStore } from "./session-ui-store"
import { useInputStore } from "./input-store"
import type { ChildStoreManager } from "./child-store"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { registerSessionDirectory } from "./sync-refs"
import { isSyntheticPart } from "@/lib/messages/synthetic"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { getSyncStoresForServer, getAllSyncStores } from "./multi-server-registry"
import { materializeSessionSnapshots } from "./materialization"
import { persistSteerSideChannelMessage } from "./steer-side-channel"
import { stripMessageDiffSnapshots } from "./sanitize"
import { formatSdkError } from "./sdk-error"
import { sessionEvents } from "@/lib/sessionEvents"
import { hasTerminalMessageSignal, type TerminalMessageSignalInfo } from "@/lib/messageCompletion"
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

/** Get the SDK client for a session's indexed server. */
function sdkForSession(sessionId?: string | null): OpencodeClient {
  if (sessionId) {
    const serverId = serverRegistry.getServerForSession(sessionId)
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      return getOrRegisterRemoteConnection(serverId).client
    }
    if (serverId === DEFAULT_SERVER_ID) {
      const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
      if (defaultConn) return defaultConn.client
      return sdk()
    }

    const conn = serverRegistry.getClientForSession(sessionId)
    if (conn && conn.config.id !== DEFAULT_SERVER_ID) {
      return conn.client
    }
    if (conn) {
      return conn.client
    }
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

/** Get the child store manager for a session's server. Falls back to default. */
function storesForSession(sessionId?: string | null): ChildStoreManager {
  if (sessionId) {
    const serverId = serverRegistry.getServerForSession(sessionId)
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const stores = getSyncStoresForServer(serverId)
      if (stores) return stores
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
  const suffix = lastDisconnectReason
    ? ` (${lastDisconnectReason})`
    : hasEverConnected
      ? ""
      : " (never connected)"
  const serverSuffix = normalizedServerId !== DEFAULT_SERVER_ID
    ? ` for ${serverRegistry.getServerLabel(normalizedServerId)}`
    : ""
  return new Error(`Connection lost${serverSuffix}${suffix}. Please wait for reconnection.`)
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null
  const directStatus = Reflect.get(error, "status")
  if (typeof directStatus === "number") return directStatus
  const response = Reflect.get(error, "response")
  if (typeof response !== "object" || response === null) return null
  const responseStatus = Reflect.get(response, "status")
  return typeof responseStatus === "number" ? responseStatus : null
}

function isAmbiguousSendFailure(error: unknown): boolean {
  const status = getErrorStatus(error)
  if (status === 408 || status === 503 || status === 504) return true
  if (error instanceof TypeError) return true
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true
  }

  const message = error instanceof Error
    ? error.message.toLowerCase()
    : typeof error === "string"
      ? error.toLowerCase()
      : ""

  return message.includes("timeout")
    || message.includes("timed out")
    || message.includes("failed to fetch")
    || message.includes("networkerror")
    || message.includes("network error")
    || message.includes("gateway timeout")
    || message.includes("econnreset")
    || message.includes("socket hang up")
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
  if (!directoryHint) return undefined
  return getServerIdForBaseUrl(resolveBaseUrlForSession(sessionId, directoryHint)) ?? undefined
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
  const stores = storesForSession(session.id)
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
  const client = sdkForSession(session.id)
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
    const error = new Error(`Move session failed${status ? ` (${status})` : ""}: ${message}`)
    if (status !== undefined) {
      ;(error as Error & { status?: number }).status = status
    }
    throw error
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
}

function isSessionNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { status?: unknown; response?: { status?: unknown } }
  return candidate.status === 404 || candidate.response?.status === 404
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
    await sdkForSession(sessionId).session.delete({ sessionID: sessionId, directory: sessionDirectory })
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
    await sdkForSession(sessionId).session.delete({ sessionID: sessionId, directory })
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

export async function archiveSession(sessionId: string): Promise<boolean> {
  const sessionDirectory = requireSessionDirectory(sessionId, "archiveSession")
  const ui = useSessionUIStore.getState()
  ui.markSessionDeleting(sessionId)
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    const archivedAt = Date.now()
    await sdkForSession(sessionId).session.update({ sessionID: sessionId, directory: sessionDirectory, time: { archived: archivedAt } })
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

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "updateSessionTitle")
  const result = await sdkForSession(sessionId).session.update({ sessionID: sessionId, directory: sessionDirectory, title })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
}

export async function patchSessionMetadata(
  sessionId: string,
  directory: string,
  transform: (metadata: Record<string, unknown>) => Record<string, unknown>,
): Promise<Session | null> {
  const sessionDirectory = directory || requireSessionDirectory(sessionId, "patchSessionMetadata")
  const sdk = sdkForSession(sessionId)
  const current = await sdk.session.get({ sessionID: sessionId, directory: sessionDirectory })
  const existingMetadata = (current.data && typeof (current.data as Session & { metadata?: unknown }).metadata === 'object' && (current.data as Session & { metadata?: unknown }).metadata !== null && !Array.isArray((current.data as Session & { metadata?: unknown }).metadata))
    ? (current.data as Session & { metadata?: Record<string, unknown> }).metadata as Record<string, unknown>
    : {}
  const nextMetadata = transform(existingMetadata)
  const result = await sdk.session.update({ sessionID: sessionId, directory: sessionDirectory, metadata: nextMetadata })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
  return result.data ?? null
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
    await sdkForSession(sessionId).session.summarize({
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
  const result = await sdkForSession(sessionId).session.share({ sessionID: sessionId, directory: sessionDirectory })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
  return result.data ?? null
}

export async function unshareSession(sessionId: string): Promise<Session | null> {
  const sessionDirectory = requireSessionDirectory(sessionId, "unshareSession")
  const result = await sdkForSession(sessionId).session.unshare({ sessionID: sessionId, directory: sessionDirectory })
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
    await waitForConnectionOrThrow(input.serverId ?? serverRegistry.getServerForSession(input.sessionId))

    await input.send(messageID)
  } catch (error) {
    const targetDirectory = input.directory
      ? normalizeDirectoryKey(input.directory)
      : getSessionDirectory(input.sessionId)
    const targetServerId = input.serverId ?? serverRegistry.getServerForSession(input.sessionId)
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
      return
    }

    // Rollback via optimistic infrastructure
    _optimisticRemove({
      sessionID: input.sessionId,
      messageID,
      directory: input.directory,
      serverId: input.serverId,
    })
    const s = store.getState()
    store.setState({
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

  const liveDirectory = _getDirectory() || undefined
  let sessionDirectory: string | undefined
  let sessionDirectoryError: string | undefined
  try {
    sessionDirectory = requireSessionDirectory(sessionId, "abortCurrentOperation")
  } catch (err) {
    sessionDirectoryError = String(err)
  }

  const directories = new Set<string>()
  const targetDirectory = sessionDirectory ?? liveDirectory
  if (targetDirectory) directories.add(targetDirectory)

  console.info("[session-actions] abort: directories resolved", {
    sessionId,
    liveDirectory: liveDirectory || null,
    sessionDirectory: sessionDirectory || null,
    sessionDirectoryError: sessionDirectoryError || null,
    candidates: [...directories],
    count: directories.size,
  })

  if (directories.size === 0) {
    console.error("[session-actions] abort: FAILED — no directory", { sessionId })
    return false
  }

  let client: OpencodeClient
  try {
    client = sdkForSession(sessionId)
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
      await sdkForSession(sessionId).session.abort({ sessionID: sessionId, directory: sessionDirectory })
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
    const result = await sdkForSession(sessionId).session.revert({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
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
  const result = await sdkForSession(sessionId).session.messages({
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
      await sdkForSession(sessionId).session.abort({ sessionID: sessionId, directory: sessionDirectory })
    } catch {
      // ignore
    }
  }

  const result = await sdkForSession(sessionId).session.unrevert({ sessionID: sessionId, directory: sessionDirectory })
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

  const result = await sdkForSession(sessionId).session.fork({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
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
