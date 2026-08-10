/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useRef, useCallback, useMemo } from "react"
import type { Event, Message, Part, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { Session } from "@opencode-ai/sdk/v2"
import type { StoreApi } from "zustand"
import { useStore } from "zustand"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createEventPipeline } from "./event-pipeline"
import { isVSCodeRuntime } from "@/lib/desktop"
import { reduceGlobalEvent, applyGlobalProject, applyDirectoryEvent } from "./event-reducer"
import { useGlobalSyncStore, type GlobalSyncStore } from "./global-sync-store"
import { ChildStoreManager, type DirectoryStore } from "./child-store"
import {
  aggregateLiveSessions,
  aggregateLiveSessionStatuses,
  areSessionListsEquivalent,
  areStatusMapsEquivalent,
  findLiveSession,
} from "./live-aggregate"
import { bootstrapGlobal, bootstrapDirectory } from "./bootstrap"
import { retry } from "./retry"
import { updateStreamingState } from "./streaming"
import { setActionRefs, resolveBaseUrl, resolveSdkForDirectory } from "./session-actions"
import { setSyncRefs } from "./sync-refs"
import { deleteShield } from "./delete-shield"
import { stripSessionDiffSnapshots } from "./sanitize"
import { syncDebug } from "./debug"
import {
  getReconnectRecoveryPlan,
  mergeBootstrapSessions,
  runReconnectMaterializations,
} from "./reconnect-recovery"
import { STUCK_SESSION_TIMEOUT_MS } from "@/stores/types/sessionTypes"
import { opencodeClient } from "@/lib/opencode/client"
import { recoverPendingMessages } from "./pending-message"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"
import { registerSyncStores, getSyncStoresForServer } from "./multi-server-registry"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { usePermissionStore } from "@/stores/permissionStore"
import { useConfigStore, type ConfigConnectionState } from "@/stores/useConfigStore"
import { useTodosPersistStore } from "@/stores/useTodosPersistStore"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { markRemoteInstanceTransportStatus } from "@/stores/useRemoteInstancesStore"
import { hasTerminalMessageSignal, type TerminalMessageSignalInfo } from "@/lib/messageCompletion"
import { dispatchOpenchamberEventEnvelope } from "@/lib/openchamberEvents"
import { toast } from "@/components/ui"
import { appendNotification, applyUnreadEventPayload, fetchAndHydrateUnreadState } from "./notification-store"
import { fetchAndHydrateMarkersState } from "@/stores/useSessionMarkersStore"
import { dispatchRemoteServerEvent, subscribeRemoteServerEvents } from "./remote-event-bus"
import type { State } from "./types"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"
import * as sessionActions from "./session-actions"
import { getSessionMaterializationStatus, materializeSessionSnapshots } from "./materialization"
import { setSessionPrefetch } from "./session-prefetch-cache"
import { listSessionsForBootstrap, SESSION_LIST_BOOTSTRAP_LIMIT } from "./session-list-bootstrap"
import { remoteSessionSummarySync } from "./remote-session-summaries"
import { readRemoteSessionStatuses } from "./remote-session-status"
import { getPageParts, type MessagePage } from "./message-page-boundary"
import { loadMessageHistoryBatch } from "./message-history-loader"
import { isPageActivelyViewed } from "./session-presence"
import { getMissingSteerSideChannelRecords, getSteerSideChannelSignature } from "./steer-side-channel"
import { getBootstrapFailureAction } from "./bootstrap-retry-policy"
import { findLatestRealUserMessage, isRealUserMessage } from "@/lib/messages/real-user"
import { classifyColdDirectoryEvent } from "./cold-directory-event"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type SyncSystem = {
  childStores: ChildStoreManager
  sdk: OpencodeClient
  directory: string
  serverId: string
}

const SYNC_CONTEXT_GLOBAL_KEY = "__openchamber_sync_context__"
type SyncGlobal = typeof globalThis & {
  [SYNC_CONTEXT_GLOBAL_KEY]?: React.Context<SyncSystem | null>
}

const syncGlobal = globalThis as SyncGlobal
const SyncContext = syncGlobal[SYNC_CONTEXT_GLOBAL_KEY] ?? createContext<SyncSystem | null>(null)
syncGlobal[SYNC_CONTEXT_GLOBAL_KEY] = SyncContext
const emptyDirectoryStoreManager = new ChildStoreManager()
const emptyDirectoryStore = emptyDirectoryStoreManager.ensureChild("__openchamber_empty__", { bootstrap: false })
const REMOTE_BOOTSTRAP_MAX_CONCURRENCY = 1
const REMOTE_BOOTSTRAP_STAGGER_MS = 350
const REMOTE_BOOTSTRAP_MAX_STAGGER_MS = 3_500
const REMOTE_RECONNECT_REQUEST_TIMEOUT_MS = 8_000

async function withRemoteTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`${label} timed out`)
      ;(error as Error & { status?: number }).status = 503
      reject(error)
    }, timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
  }
}

export function useSyncSystem() {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSyncSystem must be used within <SyncProvider>")
  return ctx
}

function getLiveStates(childStores: ChildStoreManager): State[] {
  return Array.from(childStores.children.values(), (store) => store.getState())
}

function useLiveSyncSelector<T>(selector: (states: State[]) => T, isEqual: (left: T, right: T) => boolean = Object.is): T {
  const { childStores } = useSyncSystem()
  const cacheRef = useRef<T | undefined>(undefined)
  const initializedRef = useRef(false)

  const getSnapshot = useCallback(() => {
    const next = selector(getLiveStates(childStores))
    if (initializedRef.current && isEqual(cacheRef.current as T, next)) {
      return cacheRef.current as T
    }

    cacheRef.current = next
    initializedRef.current = true
    return next
  }, [childStores, isEqual, selector])

  return React.useSyncExternalStore(
    useCallback((notify) => childStores.subscribeAll(notify), [childStores]),
    getSnapshot,
    getSnapshot,
  )
}

// ---------------------------------------------------------------------------
// Event handler — applies one SSE event at a time to the live store.
// Each event reads live state, creates a shallow draft, applies, writes back.
// React 18 batches synchronous setState calls automatically.
// ---------------------------------------------------------------------------

/** Read status for a session across all directories */
export function useGlobalSessionStatus(sessionId: string): SessionStatus | undefined {
  return useGlobalSessionsStore(
    useCallback((state) => state.sessionStatuses.get(sessionId), [sessionId]),
  )
}

/** Read all session statuses (for sidebar) */
export function useAllSessionStatuses(): Record<string, SessionStatus> {
  return useLiveSyncSelector(
    useCallback((states) => aggregateLiveSessionStatuses(states), []),
    areStatusMapsEquivalent,
  )
}

export function useAllLiveSessions(): Session[] {
  return useLiveSyncSelector(
    useCallback((states) => aggregateLiveSessions(states), []),
    areSessionListsEquivalent,
  )
}

// Boot debounce — suppresses redundant refresh/re-bootstrap events during startup.
let bootingRoot = false
let bootedAt = 0
let lastServerLifecycleRebootstrapAt = 0
const BOOT_DEBOUNCE_MS = 1500
const TRANSIENT_DISCONNECT_UI_DELAY_MS = 1500
const RECONNECT_RESYNC_RETRY_MS = 5_000
const SERVER_LIFECYCLE_REBOOTSTRAP_COOLDOWN_MS = 30_000
const RECONNECT_MESSAGE_LIMIT = 30
const SESSION_MATERIALIZATION_MESSAGE_LIMIT = 30
const RECONNECT_SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const requestSignature = (items: Array<{ id: string }> | undefined): string => {
  if (!items || items.length === 0) return ""
  return items
    .map((item) => item.id)
    .sort(cmp)
    .join("|")
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const syncSnapshotSignature = (value: unknown): string => JSON.stringify(value)

function haveEquivalentSyncSnapshots(left: unknown, right: unknown): boolean {
  return syncSnapshotSignature(left) === syncSnapshotSignature(right)
}

function pageRecords(page: MessagePage): Array<{ info: Message; parts: Part[] }> {
  return page.session.map((info) => ({
    info,
    parts: getPageParts(page, info.id) ?? [],
  }))
}

async function fetchSessionMessagesToUserBoundary(input: {
  sdkClient: OpencodeClient
  sessionID: string
  directory: string
  limit: number
  requestTimeout?: <T>(promise: Promise<T>, label: string) => Promise<T>
}): Promise<MessagePage> {
  const result = await loadMessageHistoryBatch({
    client: input.sdkClient,
    sessionID: input.sessionID,
    directory: input.directory,
    limit: input.limit,
    requestTimeout: input.requestTimeout,
  })

  if (result.stoppedBeforeBoundary) {
    console.warn("[sync] session.messages stopped before reaching a user boundary", {
      sessionID: input.sessionID,
      directory: input.directory,
      loadedMessageCount: result.page.session.length,
      extraPages: result.extraPages,
      hasCursor: Boolean(result.page.cursor),
    })
  }

  return result.page
}

// ---------------------------------------------------------------------------
// Session materialization scheduler — when local message/part state is incomplete,
// fetch the canonical session snapshot and materialize messages and parts together.
// Tracked per-directory, deduplicated, and auto-expiring.
// ---------------------------------------------------------------------------

type PendingSessionMaterialization = {
  sessionID: string
  directory: string
  enqueuedAt: number
}

const SESSION_MATERIALIZATION_COOLDOWN_MS = 5_000
const pendingSessionMaterializations = new Map<string, PendingSessionMaterialization>() // key: directory:sessionID

const materializationKey = (directory: string, sessionID: string) => `${directory}:${sessionID}`

// [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
// Added serverId parameter — materialization must use the correct remote SDK client
// instead of resolving via project store (which may not have worktree directories registered).
function enqueueSessionMaterialization(directory: string, sessionID: string, childStores: ChildStoreManager, serverId?: string) {
  if (!directory || directory === "global" || !sessionID) return
  const k = materializationKey(directory, sessionID)
  const existing = pendingSessionMaterializations.get(k)
  if (existing && Date.now() - existing.enqueuedAt < SESSION_MATERIALIZATION_COOLDOWN_MS) return

  pendingSessionMaterializations.set(k, { sessionID, directory, enqueuedAt: Date.now() })

  // Defer to next microtask so we don't hold up the current event batch
  void Promise.resolve().then(async () => {
    const store = childStores.getChild(directory)
    if (!store) {
      pendingSessionMaterializations.delete(k)
      return
    }
    try {
      await materializeSessionFromServer(directory, sessionID, store, serverId)
    } catch {
      // Transient failure — next SSE event or reconnect will catch up.
    } finally {
      pendingSessionMaterializations.delete(k)
    }
  })
}

async function materializeSessionFromServer(
  directory: string,
  sessionID: string,
  store: StoreApi<DirectoryStore>,
  serverId?: string,
) {
  // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
  // Use explicit serverId when available (e.g. from SSE event pipeline) instead of
  // reverse-resolving through project store, which misses unregistered worktree dirs.
  const sdkClient = resolveSdkForDirectory(directory, sessionID, serverId)
  const page = await fetchSessionMessagesToUserBoundary({
    sdkClient,
    sessionID,
    directory,
    limit: SESSION_MATERIALIZATION_MESSAGE_LIMIT,
  })
  if (page.session.length === 0) return
  setSessionPrefetch({
    directory,
    sessionID,
    limit: page.session.length,
    cursor: page.cursor,
    complete: page.complete,
  })

  store.setState((state: DirectoryStore) => {
    const materialized = materializeSessionSnapshots(
      state,
      sessionID,
      pageRecords(page),
      { skipPartTypes: RECONNECT_SKIP_PARTS },
    )
    if (!materialized.messagesChanged && !materialized.partsChanged) return state
    return { message: materialized.message, part: materialized.part }
  })
}

// Module-level refs for notification viewed check.
// Used to determine if user is currently viewing the session when a notification arrives.
let _activeDirectory = ""
let _activeSession = ""
const externallyViewedSessions = new Map<string, number>()
const EXTERNAL_VIEW_TTL_MS = 15_000

const viewedSessionKey = (directory: string, sessionId: string) => `${directory}\n${sessionId}`

function pruneExternallyViewedSessions(now = Date.now()) {
  for (const [key, expiresAt] of externallyViewedSessions.entries()) {
    if (expiresAt <= now) {
      externallyViewedSessions.delete(key)
    }
  }
}
const pendingQuestionToastIds = new Set<string>()
const pendingPermissionToastIds = new Set<string>()

const getQuestionToastKey = (sessionID?: string, requestID?: string) => {
  if (!sessionID || !requestID) return null
  return `${sessionID}:${requestID}`
}

const getPermissionToastKey = (sessionID?: string, requestID?: string) => {
  if (!sessionID || !requestID) return null
  return `${sessionID}:${requestID}`
}

const openSessionFromToast = (sessionID: string, directory: string) => {
  void import("./session-ui-store")
    .then(({ useSessionUIStore }) => {
      useSessionUIStore.getState().setCurrentSession(sessionID, directory)
    })
    .catch(() => undefined)
}

export function setActiveSession(directory: string, sessionId: string) {
  _activeDirectory = directory
  _activeSession = sessionId
}

export function setExternallyViewedSession(directory: string, sessionId: string, viewed: boolean) {
  if (!directory || !sessionId) return
  const key = viewedSessionKey(directory, sessionId)
  if (!viewed) {
    externallyViewedSessions.delete(key)
    return
  }
  externallyViewedSessions.set(key, Date.now() + EXTERNAL_VIEW_TTL_MS)
}

function isViewedInCurrentSession(directory: string, sessionId?: string): boolean {
  if (!sessionId) return false
  if (!isPageActivelyViewed()) return false
  if (_activeDirectory && _activeSession && directory === _activeDirectory && sessionId === _activeSession) return true
  pruneExternallyViewedSessions()
  return externallyViewedSessions.has(viewedSessionKey(directory, sessionId))
}

function isRecentBoot() {
  return bootingRoot || Date.now() - bootedAt < BOOT_DEBOUNCE_MS
}

function getViewedSessionMaterializationTarget(directory: string) {
  if (!_activeDirectory || !_activeSession) return null
  if (directory !== _activeDirectory) return null
  return {
    directory: _activeDirectory,
    sessionId: _activeSession,
  }
}

type SessionStatusSnapshot = Awaited<ReturnType<typeof opencodeClient.getSessionStatus>>[string]

function formatSdkError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function toSessionStatus(status: SessionStatusSnapshot): SessionStatus | undefined {
  if (!status) return undefined
  if (status.type === "idle" || status.type === "busy") {
    return { type: status.type }
  }
  if (
    status.type === "retry"
    && typeof status.attempt === "number"
    && typeof status.message === "string"
    && typeof status.next === "number"
  ) {
    return {
      type: "retry",
      attempt: status.attempt,
      message: status.message,
      next: status.next,
    }
  }
  return undefined
}

async function getSessionStatusForServer(
  directory: string,
  serverId: string,
): Promise<Record<string, SessionStatusSnapshot> | null> {
  if (serverId === DEFAULT_SERVER_ID) {
    return opencodeClient.getSessionStatusForDirectory(directory)
  }

  try {
    return await readRemoteSessionStatuses(serverId, directory)
  } catch {
    return null
  }
}

async function reconcileSessionStatusCandidates(
  directory: string,
  store: StoreApi<DirectoryStore>,
  serverId: string,
  candidateSessionIds: string[],
): Promise<boolean> {
  if (candidateSessionIds.length === 0) return true

  const nextStatuses = await getSessionStatusForServer(directory, serverId)
  if (nextStatuses === null) return false

  const relevantStatuses: Record<string, SessionStatus> = {}
  for (const sessionId of candidateSessionIds) {
    const nextStatus = toSessionStatus(nextStatuses[sessionId])
    relevantStatuses[sessionId] = nextStatus ?? { type: "idle" }
  }

  store.setState((state: DirectoryStore) => {
    let changed = false
    for (const [sessionId, nextStatus] of Object.entries(relevantStatuses)) {
      if (!haveEquivalentSyncSnapshots(state.session_status?.[sessionId], nextStatus)) {
        changed = true
        break
      }
    }

    if (!changed) return state

    return {
      session_status: { ...state.session_status, ...relevantStatuses },
    }
  })

  for (const [sessionId, status] of Object.entries(relevantStatuses)) {
    useGlobalSessionsStore.getState().upsertStatus(sessionId, status)
  }

  return true
}

async function listPendingQuestionsForServer(
  directory: string,
  serverId: string,
  sdk?: OpencodeClient,
): Promise<QuestionRequest[]> {
  const client = serverId === DEFAULT_SERVER_ID
    ? opencodeClient.getScopedSdkClient(directory)
    : serverRegistry.get(serverId)?.client ?? sdk
  if (!client) throw new Error(`question.list failed: missing client for server ${serverId}`)

  const request = client.question.list({ directory })
  const result = serverId === DEFAULT_SERVER_ID
    ? await request
    : await withRemoteTimeout(request, "question.list", REMOTE_RECONNECT_REQUEST_TIMEOUT_MS)
  const rawError = result.error
  if (rawError) {
    throw new Error(`question.list failed: ${formatSdkError(rawError)}`)
  }
  return result.data ?? []
}

async function listPendingPermissionsForServer(
  directory: string,
  serverId: string,
  sdk?: OpencodeClient,
): Promise<PermissionRequest[]> {
  const client = serverId === DEFAULT_SERVER_ID
    ? opencodeClient.getScopedSdkClient(directory)
    : serverRegistry.get(serverId)?.client ?? sdk
  if (!client) throw new Error(`permission.list failed: missing client for server ${serverId}`)

  const request = client.permission.list({ directory })
  const result = serverId === DEFAULT_SERVER_ID
    ? await request
    : await withRemoteTimeout(request, "permission.list", REMOTE_RECONNECT_REQUEST_TIMEOUT_MS)
  const rawError = result.error
  if (rawError) {
    throw new Error(`permission.list failed: ${formatSdkError(rawError)}`)
  }
  return result.data ?? []
}

type EventRoutingIndex = {
  sessionDirectoryById: Map<string, string>
  messageSessionById: Map<string, string>
  sessionMessageIdsById: Map<string, Set<string>>
}

const SHOULD_DISPATCH_VSCODE_NOTIFICATIONS = isVSCodeRuntime()

const dispatchVSCodeRuntimeNotificationEvent = (directory: string, payload: Event, serverId?: string) => {
  if (!SHOULD_DISPATCH_VSCODE_NOTIFICATIONS || typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("openchamber:vscode-notification-event", {
    detail: { directory, payload, serverId },
  }))
}

const createEventRoutingIndex = (): EventRoutingIndex => ({
  sessionDirectoryById: new Map(),
  messageSessionById: new Map(),
  sessionMessageIdsById: new Map(),
})

const normalizeEventDirectory = (rawDirectory: string): string => {
  if (!rawDirectory || rawDirectory === "global") {
    return rawDirectory
  }
  const normalized = rawDirectory.replace(/\\/g, "/").replace(/^([a-z]):/, (_, l: string) => l.toUpperCase() + ":")
  // Strip trailing slashes to match child store keys (normalizeDirectoryPath in useDirectoryStore)
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized
}

const normalizeDirectoryForOwnership = (directory: string): string =>
  directory.replace(/\\/g, "/").replace(/^([a-z]):/, (_, l: string) => l.toUpperCase() + ":").replace(/\/+$/, "") || "/"

const directoryBelongsToRemoteProject = (
  directory: string,
  projects: ReadonlyArray<{ path: string; serverId?: string }>,
): boolean => {
  if (!directory || directory === "global") return false
  const normalizedDirectory = normalizeDirectoryForOwnership(directory)
  for (const project of projects) {
    if (!project.serverId || project.serverId === DEFAULT_SERVER_ID) continue
    const projectPath = normalizeDirectoryForOwnership(project.path)
    if (normalizedDirectory === projectPath || normalizedDirectory.startsWith(`${projectPath}/`)) {
      return true
    }
  }
  return false
}

const shouldDefaultProviderSkipDirectory = (
  directory: string,
  projects: ReadonlyArray<{ path: string; serverId?: string }>,
): boolean => {
  if (!directory || directory === "global") return false
  return directoryBelongsToRemoteProject(directory, projects)
    || resolveBaseUrl(directory) !== undefined
}

const getSessionIdFromPayload = (event: Event): string | null => {
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") {
    return null
  }

  const props = properties as Record<string, unknown>

  if (event.type === "message.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const sessionID = (info as { sessionID?: unknown }).sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (
    event.type === "message.removed"
    || event.type === "session.status"
    || event.type === "session.idle"
    || event.type === "session.error"
    || event.type === "todo.updated"
    || event.type === "permission.asked"
    || event.type === "permission.replied"
    || event.type === "question.asked"
    || event.type === "question.replied"
    || event.type === "question.rejected"
    || event.type === "session.deleted"
  ) {
    const sessionID = props.sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (event.type === "message.part.updated") {
    const sessionID = props.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }

    const part = props.part
    if (!part || typeof part !== "object") {
      return null
    }
    const partSessionID = (part as { sessionID?: unknown }).sessionID
    return typeof partSessionID === "string" && partSessionID.length > 0 ? partSessionID : null
  }

  if (event.type === "message.part.delta" || event.type === "message.part.removed") {
    const sessionID = props.sessionID
    return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null
  }

  if (event.type === "session.created" || event.type === "session.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const id = (info as { id?: unknown }).id
    return typeof id === "string" && id.length > 0 ? id : null
  }

  return null
}

const getMessageIdFromPayload = (event: Event): string | null => {
  const properties = (event as { properties?: unknown }).properties
  if (!properties || typeof properties !== "object") {
    return null
  }

  const props = properties as Record<string, unknown>

  if (event.type === "message.updated") {
    const info = props.info
    if (!info || typeof info !== "object") {
      return null
    }
    const id = (info as { id?: unknown }).id
    return typeof id === "string" && id.length > 0 ? id : null
  }

  if (event.type === "message.removed" || event.type === "message.part.delta" || event.type === "message.part.removed") {
    const messageID = props.messageID
    return typeof messageID === "string" && messageID.length > 0 ? messageID : null
  }

  if (event.type === "message.part.updated") {
    const part = props.part
    if (!part || typeof part !== "object") {
      return null
    }
    const messageID = (part as { messageID?: unknown }).messageID
    return typeof messageID === "string" && messageID.length > 0 ? messageID : null
  }

  return null
}

const setIndexedSessionDirectory = (routingIndex: EventRoutingIndex, sessionID: string, directory: string) => {
  if (!sessionID || !directory || directory === "global") {
    return
  }
  routingIndex.sessionDirectoryById.set(sessionID, directory)
}

const setIndexedSessionMessages = (
  routingIndex: EventRoutingIndex,
  sessionID: string,
  directory: string,
  messages: Message[],
) => {
  if (!sessionID) {
    return
  }

  setIndexedSessionDirectory(routingIndex, sessionID, directory)

  const previous = routingIndex.sessionMessageIdsById.get(sessionID)
  const next = new Set<string>()

  for (const message of messages) {
    if (!message?.id) {
      continue
    }
    next.add(message.id)
    routingIndex.messageSessionById.set(message.id, sessionID)
  }

  if (previous) {
    for (const previousMessageID of previous) {
      if (!next.has(previousMessageID)) {
        routingIndex.messageSessionById.delete(previousMessageID)
      }
    }
  }

  routingIndex.sessionMessageIdsById.set(sessionID, next)
}

const setIndexedMessage = (
  routingIndex: EventRoutingIndex,
  sessionID: string,
  messageID: string,
  directory: string,
) => {
  if (!sessionID || !messageID) {
    return
  }

  setIndexedSessionDirectory(routingIndex, sessionID, directory)
  routingIndex.messageSessionById.set(messageID, sessionID)

  const existing = routingIndex.sessionMessageIdsById.get(sessionID)
  if (existing) {
    existing.add(messageID)
  } else {
    routingIndex.sessionMessageIdsById.set(sessionID, new Set([messageID]))
  }
}

const removeIndexedMessage = (
  routingIndex: EventRoutingIndex,
  messageID: string,
  sessionHint?: string | null,
) => {
  if (!messageID) {
    return
  }

  const sessionID = sessionHint ?? routingIndex.messageSessionById.get(messageID)
  routingIndex.messageSessionById.delete(messageID)

  if (!sessionID) {
    return
  }

  const messageIds = routingIndex.sessionMessageIdsById.get(sessionID)
  if (!messageIds) {
    return
  }

  messageIds.delete(messageID)
  if (messageIds.size === 0) {
    routingIndex.sessionMessageIdsById.delete(sessionID)
  }
}

const removeIndexedSession = (routingIndex: EventRoutingIndex, sessionID: string) => {
  if (!sessionID) {
    return
  }

  routingIndex.sessionDirectoryById.delete(sessionID)
  const messageIds = routingIndex.sessionMessageIdsById.get(sessionID)
  if (messageIds) {
    for (const messageID of messageIds) {
      routingIndex.messageSessionById.delete(messageID)
    }
  }
  routingIndex.sessionMessageIdsById.delete(sessionID)
}

const ingestDirectoryStateIntoRoutingIndex = (
  routingIndex: EventRoutingIndex,
  directory: string,
  state: State,
) => {
  const nextSessionIds = new Set<string>()

  for (const session of state.session) {
    if (!session?.id) {
      continue
    }
    nextSessionIds.add(session.id)
    setIndexedSessionDirectory(routingIndex, session.id, directory)
  }

  for (const sessionID of Object.keys(state.message)) {
    nextSessionIds.add(sessionID)
    setIndexedSessionDirectory(routingIndex, sessionID, directory)
    setIndexedSessionMessages(routingIndex, sessionID, directory, state.message[sessionID] ?? EMPTY_MESSAGES)
  }

  for (const [indexedSessionID, indexedDirectory] of routingIndex.sessionDirectoryById) {
    if (indexedDirectory !== directory) {
      continue
    }
    if (!nextSessionIds.has(indexedSessionID)) {
      removeIndexedSession(routingIndex, indexedSessionID)
    }
  }
}

const findSessionInChildStores = (
  sessionID: string,
  childStores: ChildStoreManager,
  routingIndex: EventRoutingIndex,
): string | null => {
  for (const [dir, store] of childStores.children) {
    const state = store.getState()
    if (
      state.session.some((s) => s.id === sessionID)
      || Object.prototype.hasOwnProperty.call(state.message, sessionID)
      || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionID)
    ) {
      // Self-heal: populate the routing index so future events resolve instantly
      setIndexedSessionDirectory(routingIndex, sessionID, dir)
      return dir
    }
  }
  return null
}

const storeHasSessionState = (
  store: StoreApi<DirectoryStore>,
  sessionID: string,
): boolean => {
  const state = store.getState()
  return state.session.some((session) => session.id === sessionID)
    || Object.prototype.hasOwnProperty.call(state.message, sessionID)
    || Object.prototype.hasOwnProperty.call(state.session_status ?? {}, sessionID)
}

const findChildStoreForSession = (
  childStores: ChildStoreManager,
  sessionID: string,
): StoreApi<DirectoryStore> | null => {
  for (const store of childStores.children.values()) {
    if (storeHasSessionState(store, sessionID)) {
      return store
    }
  }
  return null
}

const childStoreHasSessionState = (
  childStores: ChildStoreManager,
  directory: string,
  sessionID: string,
): boolean => {
  const store = childStores.getChild(directory)
  if (!store) return false
  return storeHasSessionState(store, sessionID)
}

const childStoreHasMessagePartState = (
  childStores: ChildStoreManager,
  directory: string,
  messageID: string,
): boolean => {
  const store = childStores.getChild(directory)
  if (!store) return false
  return Object.prototype.hasOwnProperty.call(store.getState().part, messageID)
}

const resolveDirectoryFromRoutingIndex = (
  routingIndex: EventRoutingIndex,
  rawDirectory: string,
  payload: Event,
  childStores: ChildStoreManager,
): string => {
  const normalizedDirectory = normalizeEventDirectory(rawDirectory)

  const sessionID = getSessionIdFromPayload(payload)
  if (sessionID) {
    if (normalizedDirectory && normalizedDirectory !== "global" && childStoreHasSessionState(childStores, normalizedDirectory, sessionID)) {
      setIndexedSessionDirectory(routingIndex, sessionID, normalizedDirectory)
      return normalizedDirectory
    }

    const indexedDirectory = routingIndex.sessionDirectoryById.get(sessionID)
    if (indexedDirectory && childStores.getChild(indexedDirectory)) {
      return indexedDirectory
    }

    // Routing index miss — scan child stores for this session.
    // Covers optimistic sessions not yet indexed and events with wrong/empty directory.
    const found = findSessionInChildStores(sessionID, childStores, routingIndex)
    if (found) {
      return found
    }
  }

  const messageID = getMessageIdFromPayload(payload)
  if (messageID) {
    if (normalizedDirectory && normalizedDirectory !== "global" && childStoreHasMessagePartState(childStores, normalizedDirectory, messageID)) {
      return normalizedDirectory
    }

    const sessionFromMessage = routingIndex.messageSessionById.get(messageID)
    if (sessionFromMessage) {
      const indexedDirectory = routingIndex.sessionDirectoryById.get(sessionFromMessage)
      if (indexedDirectory && childStores.getChild(indexedDirectory)) {
        return indexedDirectory
      }
    }

    // Scan child stores for a store that has parts for this message
    for (const [dir, store] of childStores.children) {
      if (Object.prototype.hasOwnProperty.call(store.getState().part, messageID)) {
        return dir
      }
    }
  }

  // Single-store fallback: if there's only one directory, use it
  if (
    (sessionID || messageID)
    && (!normalizedDirectory || normalizedDirectory === "global")
    && childStores.children.size === 1
  ) {
    const onlyDirectory = childStores.children.keys().next().value
    if (typeof onlyDirectory === "string" && onlyDirectory.length > 0) {
      return onlyDirectory
    }
  }

  return normalizedDirectory
}

const updateRoutingIndexFromEvent = (
  routingIndex: EventRoutingIndex,
  directory: string,
  payload: Event,
  serverId: string,
) => {
  if (!directory || directory === "global") {
    return
  }

  const sessionID = getSessionIdFromPayload(payload)
  if (sessionID) {
    setIndexedSessionDirectory(routingIndex, sessionID, directory)
  }

  switch (payload.type) {
    case "session.created":
    case "session.updated": {
      const info = (payload.properties as { info?: Session }).info
      if (info?.id) {
        setIndexedSessionDirectory(routingIndex, info.id, directory)
        serverRegistry.indexSession(info.id, serverId)
      }
      return
    }

    case "session.deleted": {
      const deletedSessionID = (payload.properties as { sessionID?: string }).sessionID
      if (deletedSessionID) {
        removeIndexedSession(routingIndex, deletedSessionID)
        serverRegistry.forgetSession(deletedSessionID)
      }
      return
    }

    case "message.updated": {
      const info = (payload.properties as { info?: Message }).info
      if (info?.id && info.sessionID) {
        setIndexedMessage(routingIndex, info.sessionID, info.id, directory)
      }
      return
    }

    case "message.removed": {
      const props = payload.properties as { sessionID?: string; messageID?: string }
      if (props.messageID) {
        removeIndexedMessage(routingIndex, props.messageID, props.sessionID)
      }
      return
    }

    case "message.part.updated": {
      const part = (payload.properties as { part?: Part }).part as (Part & { sessionID?: string; messageID?: string }) | undefined
      if (part?.messageID && part.sessionID) {
        setIndexedMessage(routingIndex, part.sessionID, part.messageID, directory)
      }
      return
    }

    default:
      return
  }
}

/**
 * Re-fetch pending questions and permissions for a directory and merge them
 * into the directory's child store, preserving any in-flight SSE updates that
 * arrived while the request was pending. Used by reconnect/materialization
 * recovery paths only; normal session switches rely on primary SSE reducer
 * state for `question.asked` / `permission.asked` events. When
 * `candidateSessionIds` is omitted, every session known to the directory store
 * is treated as a candidate; when provided, recovery is limited to those IDs.
 */
export async function resyncBlockingRequestsForDirectory(
  directory: string,
  store: StoreApi<DirectoryStore>,
  candidateSessionIds?: string[],
  options?: { serverId?: string; sdk?: OpencodeClient; includePermissions?: boolean },
) {
  const serverId = options?.serverId ?? DEFAULT_SERVER_ID
  const before = store.getState()
  const candidateIds = new Set<string>(candidateSessionIds ?? [
    ...before.session.map((session) => session.id),
    ...Object.keys(before.message ?? {}),
    ...Object.keys(before.session_status ?? {}),
    ...Object.keys(before.question ?? {}),
    ...Object.keys(before.permission ?? {}),
  ])
  const candidates = Array.from(candidateIds)
  if (candidates.length === 0) return { questions: true, permissions: true }
  let questionsSynced = true
  let permissionsSynced = true

  // Re-fetch pending questions that may have been asked during an SSE gap,
  // reconnect window, or directory materialization gap.
  try {
    const beforeSignatures = new Map(
      candidates.map((sessionId) => [sessionId, requestSignature(before.question[sessionId])]),
    )
    const pendingQuestions = await listPendingQuestionsForServer(directory, serverId, options?.sdk)
    const grouped: Record<string, QuestionRequest[]> = {}
    for (const q of pendingQuestions) {
      if (!q?.id || !q.sessionID) continue
      if (!candidateIds.has(q.sessionID)) continue
      const list = grouped[q.sessionID]
      if (list) list.push(q)
      else grouped[q.sessionID] = [q]
    }
    for (const sessionId of Object.keys(grouped)) {
      grouped[sessionId].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    for (const [sessionId, questions] of Object.entries(grouped)) {
      const knownIds = new Set((before.question[sessionId] ?? []).map((item) => item.id))
      const isViewed = isViewedInCurrentSession(directory, sessionId)
      if (isViewed) continue
      for (const question of questions) {
        if (knownIds.has(question.id)) continue
        const toastKey = getQuestionToastKey(sessionId, question.id)
        if (!toastKey || pendingQuestionToastIds.has(toastKey)) continue
        pendingQuestionToastIds.add(toastKey)
        const firstQuestion = question.questions?.[0]
        const title = firstQuestion?.header?.trim() || "Input needed"
        const description = firstQuestion?.question?.trim() || "Agent is waiting for your response"
        toast.info(title, {
          id: `question-${toastKey}`,
          description,
          action: {
            label: "Open session",
            onClick: () => openSessionFromToast(sessionId, directory),
          },
        })
      }
    }

    store.setState((state: DirectoryStore) => {
      const merged = { ...state.question }
      for (const [sessionId, questions] of Object.entries(grouped)) {
        merged[sessionId] = questions
      }
      for (const sessionId of candidates) {
        if (grouped[sessionId]) continue
        const beforeSignature = beforeSignatures.get(sessionId) ?? ""
        const currentSignature = requestSignature(state.question[sessionId])
        if (currentSignature !== beforeSignature) continue
        delete merged[sessionId]
      }
      return { question: merged }
    })
  } catch {
    questionsSynced = false
  }

  if (options?.includePermissions === false) {
    return { questions: questionsSynced, permissions: true }
  }

  // Re-fetch pending permissions — same rationale as questions.
  try {
    const beforeSignatures = new Map(
      candidates.map((sessionId) => [sessionId, requestSignature(before.permission[sessionId])]),
    )
    const pendingPermissions = await listPendingPermissionsForServer(directory, serverId, options?.sdk)
    const grouped: Record<string, PermissionRequest[]> = {}
    for (const permission of pendingPermissions) {
      if (!permission?.id || !permission.sessionID) continue
      if (!candidateIds.has(permission.sessionID)) continue
      const list = grouped[permission.sessionID]
      if (list) list.push(permission)
      else grouped[permission.sessionID] = [permission]
    }
    for (const sessionId of Object.keys(grouped)) {
      grouped[sessionId].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    }

    const permissionStore = usePermissionStore.getState()
    const autoAcceptingSessionIds = Object.keys(grouped).filter((sessionId) => permissionStore.isSessionAutoAccepting(sessionId))

    if (autoAcceptingSessionIds.length > 0) {
      await Promise.all(
        autoAcceptingSessionIds.flatMap((sessionId) =>
          (grouped[sessionId] ?? []).map((permission) =>
            sessionActions.respondToPermission(permission.sessionID, permission.id, "once").catch(() => undefined),
          ),
        ),
      )

      for (const sessionId of autoAcceptingSessionIds) {
        delete grouped[sessionId]
      }
    }

    for (const [sessionId, permissions] of Object.entries(grouped)) {
      const knownIds = new Set((before.permission[sessionId] ?? []).map((item) => item.id))
      const isViewed = isViewedInCurrentSession(directory, sessionId)
      if (isViewed) continue
      for (const permission of permissions) {
        if (knownIds.has(permission.id)) continue
        const toastKey = getPermissionToastKey(sessionId, permission.id)
        if (!toastKey || pendingPermissionToastIds.has(toastKey)) continue
        pendingPermissionToastIds.add(toastKey)
        const description = typeof permission.permission === "string" && permission.permission.trim().length > 0
          ? permission.permission
          : "Agent needs your approval"
        toast.info("Permission needed", {
          id: `permission-${toastKey}`,
          description,
          action: {
            label: "Open session",
            onClick: () => openSessionFromToast(sessionId, directory),
          },
        })
      }
    }

    store.setState((state: DirectoryStore) => {
      const merged = { ...state.permission }
      for (const [sessionId, permissions] of Object.entries(grouped)) {
        merged[sessionId] = permissions
      }
      for (const sessionId of candidates) {
        if (grouped[sessionId]) continue
        const beforeSignature = beforeSignatures.get(sessionId) ?? ""
        const currentSignature = requestSignature(state.permission[sessionId])
        if (currentSignature !== beforeSignature) continue
        delete merged[sessionId]
      }
      return { permission: merged }
    })
  } catch {
    permissionsSynced = false
  }

  return { questions: questionsSynced, permissions: permissionsSynced }
}

async function resyncDirectoryAfterReconnect(
  directory: string,
  store: StoreApi<DirectoryStore>,
  routingIndex: EventRoutingIndex,
  serverId: string,
  sdk: OpencodeClient,
) {
  const current = store.getState()
  const recoveryPlan = getReconnectRecoveryPlan(current, {
    directory,
    viewedSession: getViewedSessionMaterializationTarget(directory),
  })
  const { authoritySessionIds, materializationSessionIds } = recoveryPlan
  if (authoritySessionIds.length === 0) return true

  const statusesSynced = await reconcileSessionStatusCandidates(directory, store, serverId, authoritySessionIds)

  const scopedClient = resolveSdkForDirectory(directory, undefined, serverId) ?? sdk
  const withReconnectTimeout = <T,>(promise: Promise<T>, label: string): Promise<T> => (
    serverId !== DEFAULT_SERVER_ID
      ? withRemoteTimeout(promise, label, REMOTE_RECONNECT_REQUEST_TIMEOUT_MS)
      : promise
  )
  const materializationsSynced = await runReconnectMaterializations(materializationSessionIds, async (sessionId) => {
    const [sessionResponse, messagePage] = await Promise.all([
      withReconnectTimeout(
        scopedClient.session.get({ sessionID: sessionId, directory }),
        `session.get ${sessionId}`,
      ).catch((e: unknown) => {
        console.warn(`[resync] session.get failed for ${sessionId} on ${directory}`, e instanceof Error ? e.message : e)
        return null
      }),
      fetchSessionMessagesToUserBoundary({
        sdkClient: scopedClient,
        sessionID: sessionId,
        directory,
        limit: RECONNECT_MESSAGE_LIMIT,
        requestTimeout: withReconnectTimeout,
      }).catch((e: unknown) => {
        console.warn(`[resync] session.messages failed for ${sessionId} on ${directory}`, e instanceof Error ? e.message : e)
        return null
      }),
    ])
    const session = sessionResponse?.data
    if (!session || !messagePage) return false
    setSessionPrefetch({
      directory,
      sessionID: sessionId,
      limit: messagePage.session.length,
      cursor: messagePage.cursor,
      complete: messagePage.complete,
    })

    const nextSession = stripSessionDiffSnapshots(session)
    const nextMessages = messagePage.session

    store.setState((state: DirectoryStore) => {
      const sessionIndex = state.session.findIndex((item) => item.id === nextSession.id)
      let sessions = state.session
      let sessionChanged = false
      let sessionTotal = state.sessionTotal

      if (sessionIndex >= 0) {
        if (!haveEquivalentSyncSnapshots(sessions[sessionIndex], nextSession)) {
          sessions = [...state.session]
          sessions[sessionIndex] = nextSession
          sessionChanged = true
        }
      } else {
        sessions = [...state.session]
        sessions.push(nextSession)
        sessions.sort((a, b) => cmp(a.id, b.id))
        if (!nextSession.parentID) sessionTotal += 1
        sessionChanged = true
      }

      const materialized = materializeSessionSnapshots(
        state,
        sessionId,
        pageRecords(messagePage),
        { skipPartTypes: RECONNECT_SKIP_PARTS },
      )
      const messagesChanged = materialized.messagesChanged
      const partsChanged = materialized.partsChanged
      if (!sessionChanged && !messagesChanged && !partsChanged) {
        return state
      }

      return {
        ...(sessionChanged ? { session: sessions, sessionTotal } : {}),
        ...(messagesChanged ? { message: materialized.message } : {}),
        ...(partsChanged ? { part: materialized.part } : {}),
      }
    })

    setIndexedSessionDirectory(routingIndex, nextSession.id, directory)
    setIndexedSessionMessages(routingIndex, sessionId, directory, nextMessages)
    serverRegistry.indexSession(nextSession.id, serverId)

    const todoResult = await scopedClient.session.todo({ sessionID: sessionId }).catch(() => null)
    if (todoResult?.data) {
      store.setState((state: DirectoryStore) => ({
        todo: { ...state.todo, [sessionId]: todoResult.data },
      }))
      useTodosPersistStore.getState().setSessionTodos(sessionId, todoResult.data)
    }
    return true
  })

  const blockingRequests = await resyncBlockingRequestsForDirectory(
    directory,
    store,
    authoritySessionIds,
    { serverId, sdk },
  )

  ingestDirectoryStateIntoRoutingIndex(routingIndex, directory, store.getState())
  return materializationsSynced
    && statusesSynced
    && blockingRequests.questions
    && blockingRequests.permissions
}

function handleEvent(
  rawDirectory: string,
  payload: Event,
  childStores: ChildStoreManager,
  routingIndex: EventRoutingIndex,
  serverId: string,
  sdk: OpencodeClient,
) {
  const directory = resolveDirectoryFromRoutingIndex(routingIndex, rawDirectory, payload, childStores)
  let shouldMaterializeColdDirectory = false

  if (directory && directory !== "global" && !childStores.getChild(directory)) {
    const decision = classifyColdDirectoryEvent(payload)
    switch (decision.kind) {
      case "session":
        setIndexedSessionDirectory(routingIndex, decision.info.id, directory)
        serverRegistry.indexSession(decision.info.id, serverId)
        useGlobalSessionsStore.getState().upsertSession(decision.info)
        return
      case "status":
        setIndexedSessionDirectory(routingIndex, decision.sessionID, directory)
        serverRegistry.indexSession(decision.sessionID, serverId)
        useGlobalSessionsStore.getState().upsertStatus(decision.sessionID, decision.status)
        return
      case "delete":
        useGlobalSessionsStore.getState().removeSessions([decision.sessionID])
        removeIndexedSession(routingIndex, decision.sessionID)
        serverRegistry.forgetSession(decision.sessionID)
        return
      case "materialize":
        shouldMaterializeColdDirectory = true
        break
      case "ignore":
        if (serverId === DEFAULT_SERVER_ID) return
        break
    }
  }

  // Global events
  if (directory === "global" || !directory) {
    const globalPayload = payload as { type?: string; properties?: unknown }
    if (globalPayload.type === "openchamber:session-unread") {
      const properties = typeof globalPayload.properties === "object" && globalPayload.properties !== null
        ? globalPayload.properties
        : null
      applyUnreadEventPayload(properties)
      return
    }

    const recent = isRecentBoot()
    const result = reduceGlobalEvent(payload)
    if (!result) return
    if (result.type === "refresh") {
      // Suppress refresh during/shortly after bootstrap
      if (!recent) {
        useGlobalSyncStore.setState({ reload: "pending" })
      }
    } else if (result.type === "project") {
      const current = useGlobalSyncStore.getState()
      useGlobalSyncStore.setState({
        projects: applyGlobalProject(current, result.project).projects,
      })
    }
    // On server.connected / global.disposed, re-bootstrap all directories
    // but only if not during recent boot
    if (payload.type === "server.connected" || payload.type === "global.disposed") {
      if (payload.type === "server.connected" && serverId === DEFAULT_SERVER_ID) {
        const globalState = useGlobalSyncStore.getState()
        if (globalState.error?.type === "init") {
          globalState.actions.set({ ready: false, error: undefined })
          void bootstrapGlobal(sdk, globalState.actions.set)
        }
      }
      fetchAndHydrateUnreadState()
      fetchAndHydrateMarkersState().catch((err) => {
        console.warn("[markers] failed to hydrate markers state", err)
      })
      const now = Date.now()
      const shouldRebootstrap =
        !recent
        && now - lastServerLifecycleRebootstrapAt >= SERVER_LIFECYCLE_REBOOTSTRAP_COOLDOWN_MS

      if (shouldRebootstrap) {
        lastServerLifecycleRebootstrapAt = now
        for (const dir of childStores.children.keys()) {
          const store = childStores.getChild(dir)
          if (store && store.getState().status !== "loading") {
            // Mark as loading to trigger re-bootstrap
            store.setState({ status: "loading" as const })
            childStores.ensureChild(dir)
          }
        }
      }
    }
    return
  }

  // Directory events
  let store = childStores.getChild(directory)
  let resolvedDirectory = directory

  if (!store) {
    // Store not found for this directory — attempt recovery by scanning
    // child stores for the session. This handles directory mismatches
    // (trailing slashes, case differences, events with wrong directory).
    const sessionID = getSessionIdFromPayload(payload)
    if (sessionID) {
      const fallbackDir = findSessionInChildStores(sessionID, childStores, routingIndex)
      if (fallbackDir) {
        store = childStores.getChild(fallbackDir)
        resolvedDirectory = fallbackDir
      }
    }
  }

  if (
    !store
    && resolvedDirectory
    && resolvedDirectory !== "global"
    && (serverId !== DEFAULT_SERVER_ID || shouldMaterializeColdDirectory)
  ) {
    store = childStores.ensureChild(resolvedDirectory)
  }

  if (!store) {
    // Try as global event for unknown directories
    const result = reduceGlobalEvent(payload)
    if (result?.type === "refresh") {
      useGlobalSyncStore.setState({ reload: "pending" })
    } else if (result?.type === "project") {
      const current = useGlobalSyncStore.getState()
      useGlobalSyncStore.setState({
        projects: applyGlobalProject(current, result.project).projects,
      })
    }
    return
  }

  childStores.mark(resolvedDirectory)

  if (payload.type === "permission.asked") {
    const permission = payload.properties as PermissionRequest
    const permissionStore = usePermissionStore.getState()
    if (permissionStore.isSessionAutoAccepting(permission.sessionID)) {
      updateRoutingIndexFromEvent(routingIndex, resolvedDirectory, payload, serverId)
      void sessionActions.respondToPermission(permission.sessionID, permission.id, "once").catch(() => undefined)
      return
    }

    const toastKey = getPermissionToastKey(permission.sessionID, permission.id)
    const isViewed = isViewedInCurrentSession(resolvedDirectory, permission.sessionID)
    if (!isViewed && toastKey && !pendingPermissionToastIds.has(toastKey)) {
      pendingPermissionToastIds.add(toastKey)
      const description = typeof permission.permission === "string" && permission.permission.trim().length > 0
        ? permission.permission
        : "Agent needs your approval"
      toast.info("Permission needed", {
        id: `permission-${toastKey}`,
        description,
        action: {
          label: "Open session",
          onClick: () => openSessionFromToast(permission.sessionID, resolvedDirectory),
        },
      })
    }
  }

  if (payload.type === "permission.replied") {
    const props = payload.properties as { sessionID?: string; requestID?: string }
    const toastKey = getPermissionToastKey(props.sessionID, props.requestID)
    if (toastKey) {
      pendingPermissionToastIds.delete(toastKey)
      toast.dismiss(`permission-${toastKey}`)
    }
  }

  if (payload.type === "question.asked") {
    const question = payload.properties as QuestionRequest
    const sessionID = question.sessionID
    const toastKey = getQuestionToastKey(sessionID, question.id)
    const isViewed = isViewedInCurrentSession(resolvedDirectory, sessionID)
    if (!isViewed && toastKey && !pendingQuestionToastIds.has(toastKey)) {
      pendingQuestionToastIds.add(toastKey)
      const firstQuestion = question.questions?.[0]
      const title = firstQuestion?.header?.trim() || "Input needed"
      const description = firstQuestion?.question?.trim() || "Agent is waiting for your response"
      toast.info(title, {
        id: `question-${toastKey}`,
        description,
        action: {
          label: "Open session",
          onClick: () => openSessionFromToast(sessionID, resolvedDirectory),
        },
      })
    }
  }

  if (payload.type === "question.replied" || payload.type === "question.rejected") {
    const props = payload.properties as { sessionID?: string; requestID?: string }
    const toastKey = getQuestionToastKey(props.sessionID, props.requestID)
    if (toastKey) {
      pendingQuestionToastIds.delete(toastKey)
      toast.dismiss(`question-${toastKey}`)
    }
  }

  // Notification dispatch for session turn-complete and error events.
  // These are NOT handled by the event reducer — only the notification store.
  if (payload.type === "session.idle" || payload.type === "session.error") {
    const props = payload.properties as { sessionID?: string; error?: { message?: string; code?: string } }
    const sessionID = props.sessionID
    // Skip subtask sessions — only top-level sessions generate notifications
    const storeState = store.getState()
    const session = storeState.session.find((s) => s.id === sessionID)
    if (session && (session as { parentID?: string }).parentID) {
      // subtask — skip notification
    } else if (sessionID) {
      appendNotification({
        directory: resolvedDirectory,
        session: sessionID,
        time: Date.now(),
        viewed: isViewedInCurrentSession(resolvedDirectory, sessionID),
        ...(payload.type === "session.error"
          ? { type: "error" as const, error: props.error }
          : { type: "turn-complete" as const }),
      })
    }
  }

  // Sync-layer parent resync: when a child session goes idle, recover
  // the parent session snapshot. This ensures the
  // parent's task tool part reflects the child's completion even when
  // no ToolPart component is mounted.
  if (payload.type === "session.idle") {
    const idleSessionId = getSessionIdFromPayload(payload)
    if (idleSessionId && resolvedDirectory && resolvedDirectory !== "global") {
      const sessionState = store.getState()
      const idleSession = sessionState.session.find((s) => s.id === idleSessionId)
      const parentID = idleSession
        ? (idleSession as Session & { parentID?: string | null }).parentID
        : null
      if (parentID) {
        enqueueSessionMaterialization(resolvedDirectory, parentID, childStores, serverId)
      }
    }
  }

  // Read live state, create targeted draft cloning ONLY fields that event
  // type will mutate. This preserves reference identity for untouched slices
  // so Zustand selectors skip re-renders for unrelated subscribers.
  const current = store.getState()
  const draft: State = { ...current }

  switch (payload.type) {
    case "session.created":
    case "session.updated":
    case "session.deleted":
      draft.session = [...current.session]
      draft.message = { ...current.message }
      draft.session_status = { ...(current.session_status ?? {}) }
      draft.session_activity = { ...(current.session_activity ?? {}) }
      draft.session_diff = { ...current.session_diff }
      draft.permission = { ...current.permission }
      draft.question = { ...current.question }
      draft.todo = { ...current.todo }
      draft.part = { ...current.part }
      break
    case "session.diff":
      draft.session_diff = { ...current.session_diff }
      break
    case "session.status":
    case "session.idle":
    case "session.error":
      draft.session_status = { ...(current.session_status ?? {}) }
      draft.session_activity = { ...(current.session_activity ?? {}) }
      break
    case "todo.updated":
      draft.todo = { ...current.todo }
      break
    case "message.updated":
      draft.message = { ...current.message }
      break
    case "message.removed":
      draft.message = { ...current.message }
      draft.part = { ...current.part }
      break
    case "message.part.updated":
    case "message.part.removed":
    case "message.part.delta":
      draft.part = { ...current.part }
      draft.session_activity = { ...(current.session_activity ?? {}) }
      break
    case "vcs.branch.updated":
      break
    case "permission.asked":
    case "permission.replied":
      draft.permission = { ...current.permission }
      break
    case "question.asked":
    case "question.replied":
    case "question.rejected":
      draft.question = { ...current.question }
      break
    case "lsp.updated":
      draft.lsp = [...current.lsp]
      break
    default:
      break
  }

  const reducerResult = applyDirectoryEvent(draft, payload, {
    onSetSessionTodo: (sessionID, todos) => {
      useTodosPersistStore.getState().setSessionTodos(sessionID, todos)
    },
    isSessionDeleting: (sessionID) => deleteShield.has(sessionID),
  })
  const reducerChanged = typeof reducerResult === "boolean" ? reducerResult : reducerResult.changed
  const materializationResult = typeof reducerResult === "boolean" ? undefined : reducerResult.materialization

  if (reducerChanged) {
    store.setState(draft)
    const sessionID = getSessionIdFromPayload(payload) ?? undefined
    const messageID = getMessageIdFromPayload(payload) ?? undefined
    syncDebug.dispatch.eventApplied(payload.type, sessionID, messageID)

    // [sscity-mod] Global sessions store sync — keep our multi-server session status dispatch.
    if (payload.type === "session.status") {
      const statusProps = payload.properties as { sessionID: string; status: SessionStatus }
      if (statusProps.sessionID && statusProps.status) {
        useGlobalSessionsStore.getState().upsertStatus(statusProps.sessionID, statusProps.status)
      }
    } else if (payload.type === "session.idle" || payload.type === "session.error") {
      if (sessionID) {
        useGlobalSessionsStore.getState().upsertStatus(sessionID, { type: "idle" })
      }
    } else if (payload.type === "session.updated") {
      const info = (payload.properties as { info?: Session }).info
      if (info?.id) {
        useGlobalSessionsStore.getState().upsertSession(info)
      }
    }

    // Parts-gap recovery on message.updated: if the message was inserted or
    // replaced but draft.part[messageID] is empty, the parts were lost or
    // never arrived. Recover the session so the UI doesn't render a blank bubble.
    if (sessionID && messageID && payload.type === "message.updated") {
      const after = store.getState()
      const info = (payload.properties as { info: Message }).info
      if (info.role === "assistant" && (!after.part[messageID] || after.part[messageID].length === 0)) {
        enqueueSessionMaterialization(resolvedDirectory, sessionID, childStores, serverId)
      }
    }
  } else {
    const sessionID = getSessionIdFromPayload(payload) ?? undefined
    const messageID = getMessageIdFromPayload(payload) ?? undefined
    syncDebug.dispatch.eventNoChange(payload.type, sessionID, messageID)

    // Global store status sync must happen even when the child store didn't change —
    // batchLoadStatuses may have set a stale "busy" in the global store while the
    // child store was already idle, causing the reducer to no-op.
    if (payload.type === "session.status") {
      const statusProps = payload.properties as { sessionID: string; status: SessionStatus }
      if (statusProps.sessionID && statusProps.status) {
        useGlobalSessionsStore.getState().upsertStatus(statusProps.sessionID, statusProps.status)
      }
    } else if (payload.type === "session.idle" || payload.type === "session.error") {
      if (sessionID) {
        useGlobalSessionsStore.getState().upsertStatus(sessionID, { type: "idle" })
      }
    }
  }

  // Snapshot materialization is driven by typed reducer outcomes, not by
  // inferring meaning from a generic false/no-change result.
  if (materializationResult) {
    const materializationSessionID = materializationResult.sessionID ?? getSessionIdFromPayload(payload) ?? undefined
    if (materializationSessionID) {
      enqueueSessionMaterialization(resolvedDirectory, materializationSessionID, childStores, serverId)
    }
  }

  updateRoutingIndexFromEvent(routingIndex, resolvedDirectory, payload, serverId)
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const dispatchOpenCodeUpdateAvailable = (payload: { version: string }) => {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("openchamber:opencode-update-available", { detail: payload }))
}

export function SyncProvider(props: {
  sdk: OpencodeClient
  directory: string
  serverId?: string
  baseUrl?: string
  eventSource?: "pipeline" | "bus"
  remoteDirectories?: string[]
  children: React.ReactNode
}) {
  const serverId = props.serverId ?? DEFAULT_SERVER_ID
  const eventSource = props.eventSource ?? "pipeline"
  const configuredMessageStreamTransport = useConfigStore((state) => state.settingsMessageStreamTransport)
  const messageStreamTransport = configuredMessageStreamTransport === "sse"
    ? "sse"
    : "ws"
  const projects = useProjectsStore((state) => state.projects)
  const childStoresRef = useRef<ChildStoreManager | null>(null)
  if (!childStoresRef.current) childStoresRef.current = new ChildStoreManager(serverId)
  const childStores = childStoresRef.current
  const pendingMessagesRecoveredRef = useRef(false)
  const pipelineHasConnectedRef = useRef(false)
  const pipelineDisconnectedBeforeFirstConnectRef = useRef(false)
  const routingIndexRef = useRef<EventRoutingIndex | null>(null)
  if (!routingIndexRef.current) routingIndexRef.current = createEventRoutingIndex()
  const routingIndex = routingIndexRef.current

  const system = useMemo<SyncSystem>(
    () => ({
      childStores,
      sdk: props.sdk,
      directory: props.directory,
      serverId,
    }),
    [childStores, props.sdk, props.directory, serverId],
  )

  useEffect(() => {
    const unregister = registerSyncStores(
      serverId,
      childStores,
      () => {},
    )
    return () => {
      if (serverId !== DEFAULT_SERVER_ID) {
        const catalog = useGlobalSessionsStore.getState()
        const existingIds = new Set(
          [...catalog.activeSessions, ...catalog.archivedSessions].map((s) => s.id),
        )
        let promoted = false
        for (const store of childStores.children.values()) {
          for (const session of store.getState().session) {
            if (session?.id && !existingIds.has(session.id)) {
              catalog.upsertSession(session)
              promoted = true
            }
          }
        }
        if (promoted) {
          console.log(`[sync] promoted child-store sessions to global catalog before unregister: ${serverId}`)
        }
      }
      unregister()
    }
  }, [serverId, childStores])

  // Configure child store manager
  useEffect(() => {
    const bootingDirs = new Set<string>()
    const scheduledRemoteDirs = new Set<string>()
    const queuedRemoteDirs = new Set<string>()
    const remoteBootstrapQueue: string[] = []
    const loadingSessionDirs = new Set<string>()
    let activeRemoteBootstraps = 0
    let nextRemoteBootstrapDelayMs = 0

    const drainRemoteBootstrapQueue = () => {
      if (activeRemoteBootstraps >= REMOTE_BOOTSTRAP_MAX_CONCURRENCY) return
      const next = remoteBootstrapQueue.shift()
      if (!next) {
        nextRemoteBootstrapDelayMs = 0
        return
      }

      queuedRemoteDirs.delete(next)
      if (!childStores.getChild(next) || bootingDirs.has(next)) {
        drainRemoteBootstrapQueue()
        return
      }

      activeRemoteBootstraps += 1
      startBootstrap(next, () => {
        activeRemoteBootstraps = Math.max(0, activeRemoteBootstraps - 1)
        drainRemoteBootstrapQueue()
      })
    }

    const enqueueRemoteBootstrap = (directory: string) => {
      if (queuedRemoteDirs.has(directory) || bootingDirs.has(directory)) return
      queuedRemoteDirs.add(directory)
      remoteBootstrapQueue.push(directory)
      drainRemoteBootstrapQueue()
    }

    const scheduleRemoteBootstrap = (directory: string) => {
      if (scheduledRemoteDirs.has(directory) || queuedRemoteDirs.has(directory) || bootingDirs.has(directory)) return
      scheduledRemoteDirs.add(directory)
      const delayMs = nextRemoteBootstrapDelayMs
      nextRemoteBootstrapDelayMs = Math.min(
        nextRemoteBootstrapDelayMs + REMOTE_BOOTSTRAP_STAGGER_MS,
        REMOTE_BOOTSTRAP_MAX_STAGGER_MS,
      )
      window.setTimeout(() => {
        scheduledRemoteDirs.delete(directory)
        if (!childStores.getChild(directory) || bootingDirs.has(directory)) return
        enqueueRemoteBootstrap(directory)
      }, delayMs)
    }

    const startBootstrap = (directory: string, onDone?: () => void) => {
      bootingDirs.add(directory)

      const store = childStores.getChild(directory)
      if (!store) {
        bootingDirs.delete(directory)
        onDone?.()
        return
      }

      const runBootstrap = async (attempt: number) => {
        const globalState = useGlobalSyncStore.getState()
        const bootstrapped = await bootstrapDirectory({
          directory,
          sdk: props.sdk,
          getState: () => store.getState(),
          set: (patch) => {
            store.setState(patch)
            if (patch.session || patch.message) {
              ingestDirectoryStateIntoRoutingIndex(routingIndex, directory, store.getState())
            }
          },
          global: {
            config: globalState.config,
            projects: globalState.projects,
            providers: globalState.providers,
          },
          loadSessions: async (dir) => {
            loadingSessionDirs.add(dir)
            try {
              await retry(async () => {
                const catalog = useGlobalSessionsStore.getState()
                const baselineRevision = catalog.catalogRevision
                // Roots fetch is authoritative: failure must throw (retry / abort apply).
                // Do not treat fetch failure as a successful empty list.
                const rootSessions = (await listSessionsForBootstrap(props.sdk, serverId, dir, undefined, { roots: true }))
                  .filter((session) => Boolean(session?.id))
                  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

                let allSessions: Session[] | null = null
                try {
                  allSessions = await listSessionsForBootstrap(props.sdk, serverId, dir, undefined, { roots: false })
                } catch (error) {
                  // Child/full list is best-effort; keep known children via mergeBootstrapSessions(null).
                  console.warn(`[bootstrap] child session.list failed for ${dir}; retaining known children`, error)
                }

                const current = store.getState()
                const { sessions: mergedSessions, rootCount } = mergeBootstrapSessions(
                  rootSessions,
                  allSessions,
                  current.session,
                  {
                    baselineRevision,
                    eventRevision: catalog.sessionEventRevision,
                    deletedRevision: catalog.sessionDeletedRevision,
                  },
                )

                // Preserve only scoped sessions with a live reason — not the entire store catalog.
                const mergedIds = new Set(mergedSessions.map((session) => session.id))
                const statusMap = current.session_status ?? {}
                const protectedExtras = current.session.filter((session) => {
                  if (!session.id || mergedIds.has(session.id) || deleteShield.has(session.id)) {
                    return false
                  }
                  const status = statusMap[session.id]
                  return Boolean(status && status.type !== "idle")
                })
                const sessions = (protectedExtras.length > 0
                  ? [...mergedSessions, ...protectedExtras]
                  : mergedSessions.length === 0 && current.session.length > 0
                    ? current.session
                    : mergedSessions
                )
                  .filter((session) => !deleteShield.has(session.id))
                  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

                store.setState({
                  session: sessions,
                  sessionTotal: rootCount,
                  limit: Math.max(sessions.length, 50),
                })
                for (const session of sessions) {
                  if (session.id) serverRegistry.indexSession(session.id, serverId)
                }
                useGlobalSessionsStore.getState().applyDirectorySnapshot(serverId, dir, sessions, {
                  baselineRevision,
                  isComplete: rootSessions.length < SESSION_LIST_BOOTSTRAP_LIMIT,
                })
                ingestDirectoryStateIntoRoutingIndex(routingIndex, dir, store.getState())
              })
            } finally {
              loadingSessionDirs.delete(dir)
            }
          },
          loadMetadata: serverId === DEFAULT_SERVER_ID,
        })

        if (!bootstrapped) {
          if (getBootstrapFailureAction(attempt) === "retry") {
            const logRetry = attempt < 2 ? console.info : console.warn
            logRetry(`[bootstrap] bootstrap failed for ${directory} after attempt ${attempt + 1}; retrying in 2s`)
            await new Promise((r) => setTimeout(r, 2000))
            await runBootstrap(attempt + 1)
          } else {
            console.error(`[bootstrap] bootstrap failed for ${directory} after ${attempt + 1} attempts; giving up`)
            store.setState({ status: "complete" as const })
          }
          return
        }

        // VS Code race: if sessions are still empty after bootstrap, OpenCode
        // wasn't ready yet (bridge returned 503). Retry a few times.
        const state = store.getState()
        const sessionCount = Array.isArray(state.session) ? state.session.length : 0
        const shouldRetryEmptySessionList = serverId === DEFAULT_SERVER_ID
        if (shouldRetryEmptySessionList && sessionCount === 0 && attempt < 5) {
          console.warn(`[bootstrap] sessions empty for ${directory} after attempt ${attempt + 1}; retrying in 2s`)
          await new Promise((r) => setTimeout(r, 2000))
          store.setState({ status: "loading" as const })
          await runBootstrap(attempt + 1)
        } else if (sessionCount === 0) {
          console.warn(`[bootstrap] sessions empty for ${directory} after ${attempt + 1} attempts; giving up`)
          store.setState({ status: "complete" as const })
        }
      }

      runBootstrap(0).then(() => {
        if (store.getState().status === "complete") {
          void import("./session-ui-store").then(({ useSessionUIStore }) => {
            useSessionUIStore.getState().adoptAuthoritativeSessionDirectory()
          })
        }
        const { isConnected } = useConfigStore.getState().getConnectionState(serverId)
        if (isConnected && store.getState().status === "complete") {
          void resyncDirectoryAfterReconnect(directory, store, routingIndex, serverId, props.sdk).catch(() => {})
        }
      }).finally(() => {
        bootingDirs.delete(directory)
        onDone?.()
      })
    }

    childStores.configure({
      onBootstrap: (directory) => {
        if (serverId === DEFAULT_SERVER_ID && shouldDefaultProviderSkipDirectory(directory, projects)) {
          childStores.disposeDirectory(directory)
          return
        }

        if (bootingDirs.has(directory)) return

        if (serverId !== DEFAULT_SERVER_ID) {
          scheduleRemoteBootstrap(directory)
          return
        }

        startBootstrap(directory)
      },
      onDispose: (directory) => {
        bootingDirs.delete(directory)
        scheduledRemoteDirs.delete(directory)
        queuedRemoteDirs.delete(directory)
        loadingSessionDirs.delete(directory)
        const queueIndex = remoteBootstrapQueue.indexOf(directory)
        if (queueIndex >= 0) remoteBootstrapQueue.splice(queueIndex, 1)
        if (serverId === DEFAULT_SERVER_ID && shouldDefaultProviderSkipDirectory(directory, projects)) return
        void props.sdk.instance.dispose({ directory }).then(
          (result) => {
            if (!result.error) return
            console.warn("[sync] failed to dispose OpenCode directory instance", {
              directory,
              serverId,
              error: result.error,
            })
          },
          (error: unknown) => {
            console.warn("[sync] failed to dispose OpenCode directory instance", {
              directory,
              serverId,
              error,
            })
          },
        )
      },
      isBooting: (directory) => bootingDirs.has(directory) || scheduledRemoteDirs.has(directory) || queuedRemoteDirs.has(directory),
      isLoadingSessions: (directory) => loadingSessionDirs.has(directory),
    })
  }, [childStores, props.sdk, routingIndex, serverId, projects])

  // Bootstrap global state — set bootingRoot/bootedAt to suppress
  // redundant refresh events during startup
  useEffect(() => {
    if (serverId !== DEFAULT_SERVER_ID) return
    bootingRoot = true
    const globalActions = useGlobalSyncStore.getState().actions
    bootstrapGlobal(props.sdk, globalActions.set)
      .then(() => {
        bootedAt = Date.now()
        fetchAndHydrateUnreadState()
        fetchAndHydrateMarkersState().catch((err) => {
          console.warn("[markers] failed to hydrate markers state", err)
        })
      })
      .finally(() => {
        bootingRoot = false
      })
  }, [props.sdk, serverId])

  // Event pipeline — created once per mount. No class, no start/stop.
  // Abort controller owned by the pipeline closure. Cleanup aborts + flushes.
  useEffect(() => {
    const reconnectResyncing = new Set<string>()
    const reconnectResyncRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const reconnectResyncFailureLogged = new Set<string>()
    let streamDisconnected = false
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null
    const setProviderConnectionState = (patch: Partial<ConfigConnectionState>) => {
      useConfigStore.getState().setConnectionState(serverId, patch)
    }
    const getProviderConnectionState = () => useConfigStore.getState().getConnectionState(serverId)
    const markRemoteTransportStatus = (connected: boolean, reason?: string) => {
      if (serverId === DEFAULT_SERVER_ID) return
      markRemoteInstanceTransportStatus(serverId, connected, reason)
    }

    const clearDisconnectTimer = () => {
      if (!disconnectTimer) return
      clearTimeout(disconnectTimer)
      disconnectTimer = null
    }

    const scheduleReconnectRetry = (directory: string) => {
      if (reconnectResyncRetryTimers.has(directory)) return
      const timer = setTimeout(() => {
        reconnectResyncRetryTimers.delete(directory)
        if (!getProviderConnectionState().isConnected) return
        triggerReconnectMaterialization(directory)
      }, RECONNECT_RESYNC_RETRY_MS)
      reconnectResyncRetryTimers.set(directory, timer)
    }

    const handleReconnectFailure = (directory: string, error?: unknown) => {
      if (!reconnectResyncFailureLogged.has(directory)) {
        reconnectResyncFailureLogged.add(directory)
        console.warn("[sync] reconnect reconciliation incomplete", { directory, serverId, error })
      }
      scheduleReconnectRetry(directory)
    }

    function triggerReconnectMaterialization(directory: string) {
      const store = childStores.getChild(directory)
      if (!store) return
      if (reconnectResyncing.has(directory)) return

      reconnectResyncing.add(directory)
      void resyncDirectoryAfterReconnect(directory, store, routingIndex, serverId, props.sdk)
        .then((synced) => {
          if (!synced) {
            handleReconnectFailure(directory)
            return
          }
          reconnectResyncFailureLogged.delete(directory)
        })
        .catch((error: unknown) => {
          handleReconnectFailure(directory, error)
        })
        .finally(() => {
          reconnectResyncing.delete(directory)
        })
    }

    const applyDisconnectedState = (reason: string) => {
      const { hasEverConnected } = getProviderConnectionState()
      setProviderConnectionState({
        isConnected: false,
        connectionPhase: hasEverConnected ? "reconnecting" : "connecting",
        lastDisconnectReason: reason,
      })
      markRemoteTransportStatus(false, reason)
    }

    const applyIncomingEvent = (directory: string, payload: Event) => {
      dispatchVSCodeRuntimeNotificationEvent(directory, payload, serverId)
      dispatchOpenchamberEventEnvelope(payload as { type?: unknown; properties?: unknown })
      if (payload.type === "installation.update-available") {
        const version = typeof (payload.properties as { version?: unknown })?.version === "string"
          ? (payload.properties as { version: string }).version
          : ""
        if (version) {
          dispatchOpenCodeUpdateAvailable({ version })
        }
      }
      handleEvent(directory, payload, childStores, routingIndex, serverId, props.sdk)
    }

    if (eventSource === "bus") {
      setProviderConnectionState({
        isConnected: true,
        hasEverConnected: true,
        connectionPhase: "connected",
        lastDisconnectReason: null,
      })
      markRemoteTransportStatus(true)
      for (const dir of childStores.children.keys()) {
        triggerReconnectMaterialization(dir)
      }

      const unsubscribe = subscribeRemoteServerEvents(serverId, ({ directory, payload }) => {
        const resolvedDirectory = resolveDirectoryFromRoutingIndex(routingIndex, directory, payload, childStores)
        applyIncomingEvent(resolvedDirectory, payload)
      })

      return () => {
        clearDisconnectTimer()
        unsubscribe()
      }
    }

    const { cleanup } = createEventPipeline({
      sdk: props.sdk,
      baseUrl: props.baseUrl,
      transport: messageStreamTransport,
      routeDirectory: (directory, payload) => {
        return resolveDirectoryFromRoutingIndex(routingIndex, directory, payload, childStores)
      },
      onEvent: (directory, payload, meta) => {
        const eventServerId = meta?.serverId
        if (eventServerId && eventServerId !== serverId) {
          dispatchRemoteServerEvent({
            serverId: eventServerId,
            directory,
            payload,
          })
          return
        }
        applyIncomingEvent(directory, payload)
      },
      onReconnect: () => {
        streamDisconnected = false
        clearDisconnectTimer()
        setProviderConnectionState({
          isConnected: true,
          hasEverConnected: true,
          connectionPhase: "connected",
          lastDisconnectReason: null,
        })
        markRemoteTransportStatus(true)
        const isFirstConnect = !pipelineHasConnectedRef.current
        pipelineHasConnectedRef.current = true
        if (!isFirstConnect || pipelineDisconnectedBeforeFirstConnectRef.current) {
          for (const dir of childStores.children.keys()) {
            triggerReconnectMaterialization(dir)
          }
        }
        // One-time pending message recovery after first SSE connection
        if (!pendingMessagesRecoveredRef.current) {
          pendingMessagesRecoveredRef.current = true
          void recoverPendingMessages()
        }
      },
      onDisconnect: (reason) => {
        if (!pipelineHasConnectedRef.current) {
          pipelineDisconnectedBeforeFirstConnectRef.current = true
        }
        streamDisconnected = true
        clearDisconnectTimer()
        setProviderConnectionState({ lastDisconnectReason: reason })

        const { hasEverConnected } = getProviderConnectionState()
        if (!hasEverConnected) {
          applyDisconnectedState(reason)
          return
        }

        disconnectTimer = setTimeout(() => {
          disconnectTimer = null
          if (!streamDisconnected) return
          applyDisconnectedState(reason)
        }, TRANSIENT_DISCONNECT_UI_DELAY_MS)
      },
    })
    return () => {
      clearDisconnectTimer()
      for (const timer of reconnectResyncRetryTimers.values()) clearTimeout(timer)
      reconnectResyncRetryTimers.clear()
      cleanup()
    }
  }, [props.sdk, props.baseUrl, childStores, routingIndex, messageStreamTransport, serverId, eventSource])

  // Ensure current directory's child store exists
  // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
  // Guard: default SyncProvider must not create child stores for remote paths.
  // Active project carries serverId set by the sidebar on project click — zero path matching.
  useEffect(() => {
    if (props.directory) {
      if (serverId === DEFAULT_SERVER_ID) {
        if (shouldDefaultProviderSkipDirectory(props.directory, projects)) {
          childStores.disposeDirectory(props.directory)
          return
        }
      }
      const store = childStores.ensureChild(props.directory)
      ingestDirectoryStateIntoRoutingIndex(routingIndex, props.directory, store.getState())
    }
  }, [props.directory, childStores, routingIndex, serverId, projects])

  useEffect(() => {
    if (serverId === DEFAULT_SERVER_ID) return
    const dirs = props.remoteDirectories
    if (!dirs?.length) return

    const controller = new AbortController()
    const baselineRevision = useGlobalSessionsStore.getState().catalogRevision
    void remoteSessionSummarySync.scan({
      serverId,
      directories: dirs,
      signal: controller.signal,
      onSnapshot: (directory, sessions) => {
        useGlobalSessionsStore.getState().applyRemoteDirectorySnapshot(serverId, directory, sessions, {
          baselineRevision,
          isComplete: sessions.length < SESSION_LIST_BOOTSTRAP_LIMIT,
        })
        for (const session of sessions) {
          if (session.id) {
            setIndexedSessionDirectory(routingIndex, session.id, directory)
            serverRegistry.indexSession(session.id, serverId)
          }
        }
      },
    }).then((result) => {
      if (result.scannedDirectories.length > 0) {
        console.info(
          `[remote-session-summaries] scan complete server=${serverId}`
          + ` requested=${dirs.length}`
          + ` scanned=${result.scannedDirectories.length}`
          + ` failed=${result.failedDirectories.length}`,
        )
      }
      if (result.failures.length === 0) return
      console.warn(
        `[remote-session-summaries] scan incomplete server=${serverId}`
        + ` failed=${result.failedDirectories.join(",")}`,
        result.failures[0]?.error,
      )
    }).catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") return
      console.warn("[remote-session-summaries] scan failed", { serverId, error })
    })

    return () => controller.abort()
  }, [serverId, props.remoteDirectories, routingIndex])

  // Set refs so non-React code (session-actions, session-ui-store) can access sync state
  useEffect(() => {
    if (serverId !== DEFAULT_SERVER_ID) {
      return
    }
    setSyncRefs(props.sdk, childStores, props.directory, (sessionID, dir) => {
      setIndexedSessionDirectory(routingIndex, sessionID, dir)
    }, (sessionID) => routingIndex.sessionDirectoryById.get(sessionID))
    setActionRefs(
      props.sdk,
      childStores,
      () => opencodeClient.getDirectory() || props.directory,
    )
  }, [serverId, props.sdk, props.directory, childStores, routingIndex])

  // Subscribe to child store for streaming state derivation
  useEffect(() => {
    if (!props.directory) return
    const store = childStores.getChild(props.directory)
    if (!store) return
    const unsubscribe = store.subscribe((state) => {
      updateStreamingState(state)
    })
    return unsubscribe
  }, [props.directory, childStores])


  useEffect(() => {
    const reconcilingDirectories = new Set<string>()
    const stuckCheckInterval = setInterval(() => {
      const { isConnected } = useConfigStore.getState().getConnectionState(serverId)
      if (!isConnected) return

      const now = Date.now()
      for (const [directory, store] of childStores.children) {
        if (reconcilingDirectories.has(directory)) continue

        const state = store.getState()
        const statuses = state.session_status
        if (!statuses) continue

        const staleSessionIds: string[] = []

        for (const [sessionId, status] of Object.entries(statuses)) {
          if (!status || status.type === "idle") continue

          // Check if the session has received any recent activity.
          // If messages exist, use the latest assistant message's creation time.
          // If no messages, use a heuristic based on session existence.
          const messages = state.message[sessionId]
          let lastActivityAt = 0
          if (messages && messages.length > 0) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const msg = messages[i]
              if (msg.role === "assistant") {
                const created = typeof (msg as { time?: { created?: number } }).time?.created === "number"
                  ? (msg as { time?: { created?: number } }).time!.created!
                  : 0
                const completed = typeof (msg as { time?: { completed?: number } }).time?.completed === "number"
                  ? (msg as { time?: { completed?: number } }).time!.completed!
                  : 0
                lastActivityAt = Math.max(created, completed)
                break
              }
            }
          }

          if (lastActivityAt > 0 && now - lastActivityAt > STUCK_SESSION_TIMEOUT_MS) {
            staleSessionIds.push(sessionId)
          } else if (lastActivityAt === 0) {
            const session = state.session.find((s) => s.id === sessionId)
            const sessionUpdated = session?.time?.updated ?? 0
            if (sessionUpdated > 0 && now - sessionUpdated > STUCK_SESSION_TIMEOUT_MS) {
              staleSessionIds.push(sessionId)
            }
          }
        }

        if (staleSessionIds.length === 0) continue

        reconcilingDirectories.add(directory)
        void reconcileSessionStatusCandidates(directory, store, serverId, staleSessionIds)
          .finally(() => reconcilingDirectories.delete(directory))
      }
    }, STUCK_SESSION_TIMEOUT_MS / 2) // Check at half the timeout for reasonable resolution

    return () => clearInterval(stuckCheckInterval)
  }, [childStores, serverId])

  // Re-fetch pending questions/permissions on session-switch.
  // PR #909 only re-fetches on SSE reconnect, leaving an event-drop gap when
  // switching sessions within the same socket — the question.asked event may
  // have arrived while a different session was active and the directory store
  // was evicted, or the user may navigate back to a directory whose store was
  // rebuilt after eviction. A 250ms debounce coalesces rapid switches.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastSessionId: string | null = null
    let unsub: (() => void) | undefined
    void import("./session-ui-store")
      .then(({ useSessionUIStore }) => {
        if (cancelled) return
        lastSessionId = useSessionUIStore.getState().currentSessionId
        unsub = useSessionUIStore.subscribe((state) => {
          const nextSessionId = state.currentSessionId
          if (nextSessionId === lastSessionId) return
          lastSessionId = nextSessionId
          if (!nextSessionId) return
          const sessionDirectory = state.getDirectoryForSession(nextSessionId)
            ?? opencodeClient.getDirectory()
            ?? props.directory
          if (!sessionDirectory) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const currentStore = childStores.getChild(sessionDirectory)
            if (!currentStore) return
            void resyncBlockingRequestsForDirectory(sessionDirectory, currentStore, undefined, { serverId, sdk: props.sdk })
              .catch(() => undefined)
          }, 250)
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      unsub?.()
    }
  }, [props.directory, childStores, serverId, props.sdk])

  return <SyncContext.Provider value={system}>{props.children}</SyncContext.Provider>
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Access the global sync store */
export function useGlobalSync() {
  return useGlobalSyncStore()
}

/** Access the global sync store with a selector */
export function useGlobalSyncSelector<T>(selector: (state: GlobalSyncStore) => T): T {
  return useGlobalSyncStore(selector)
}

/** Get the child store for a directory (defaults to current) */
// [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
// Accept optional serverId and sessionID. When a remote session's directory is
// unknown, search the remote SyncProvider's child stores for the session.
export function useDirectoryStore(directory?: string, serverId?: string, sessionID?: string): StoreApi<DirectoryStore> {
  const system = useSyncSystem()
  const dir = directory ?? system.directory

  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remoteStores = getSyncStoresForServer(serverId)
    if (remoteStores) {
      if (!directory && sessionID) {
        const remoteStore = findChildStoreForSession(remoteStores, sessionID)
        if (remoteStore) return remoteStore
      }
      if (!directory) {
        return emptyDirectoryStore
      }
      return remoteStores.ensureChild(directory)
    }
  }

  if (!directory && sessionID) {
    const sessionStore = findChildStoreForSession(system.childStores, sessionID)
    if (sessionStore) return sessionStore
    // A session-scoped lookup with no directory must not fall back to the
    // globally active directory: the session may belong to a remote server
    // whose store has not mounted yet, and binding it to the local current
    // directory would render the wrong project's state. Return an explicit
    // unresolved store so consumers render loading/empty until authority
    // resolves.
    const indexedServerId = serverRegistry.getServerForSession(sessionID)
    if (indexedServerId && indexedServerId !== DEFAULT_SERVER_ID) {
      return emptyDirectoryStore
    }
  }

  return system.childStores.ensureChild(dir)
}

/** Select from the current directory's store */
export function useDirectorySync<T>(selector: (state: State) => T, directory?: string, serverId?: string, sessionID?: string): T {
  const store = useDirectoryStore(directory, serverId, sessionID)
  return useStore(store, selector)
}

// [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
// Resolve serverId for a session from the registry. Used by session-scoped hooks
// to route to the correct remote store without any path matching.
function useServerIdForSession(sessionID: string | undefined): string | undefined {
  return React.useSyncExternalStore(
    useCallback(
      (notify) => sessionID
        ? serverRegistry.onSessionServerChange(sessionID, notify)
        : () => undefined,
      [sessionID],
    ),
    useCallback(
      () => sessionID ? serverRegistry.getServerForSession(sessionID) : undefined,
      [sessionID],
    ),
    () => undefined,
  )
}

/** Get the revert messageID for a session (if reverted) */
export function useSessionRevertMessageID(sessionID: string, directory?: string): string | undefined {
  return useDirectorySync(
    useCallback((state: State) => {
      const session = state.session.find((s) => s.id === sessionID)
      return (session as { revert?: { messageID?: string } } | undefined)?.revert?.messageID
    }, [sessionID]),
    directory,
    useServerIdForSession(sessionID),
    sessionID,
  )
}

/** Get session messages for a specific session */
export function useSessionMessages(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const getSnapshot = useCallback(() => {
    if (!sessionID) return EMPTY_MESSAGES
    return store.getState().message[sessionID] ?? EMPTY_MESSAGES
  }, [sessionID, store])
  const subscribe = useCallback((notify: () => void) => {
    if (!sessionID) return () => undefined
    return store.subscribe(notify)
  }, [sessionID, store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Latest human-authored user message. Internal OMO directives are not picker/input authority. */
export function useLatestRealUserMessage(sessionID: string, directory?: string): Message | undefined {
  const serverId = useServerIdForSession(sessionID)
  return useDirectorySync(
    useCallback((state: State) => {
      if (!sessionID) return undefined
      return findLatestRealUserMessage(state.message[sessionID] ?? EMPTY_MESSAGES, state.part)
    }, [sessionID]),
    directory,
    serverId,
    sessionID,
  )
}

/**
 * Get visible session messages — filters out reverted messages.
 * Filters out reverted messages (id >= session.revert.messageID).
 */
export function useVisibleSessionMessages(sessionID: string, directory?: string) {
  const messages = useSessionMessages(sessionID, directory)
  const revertMessageID = useSessionRevertMessageID(sessionID, directory)
  return useMemo(() => {
    if (!revertMessageID) return messages
    return messages.filter((m) => m.id < revertMessageID)
  }, [messages, revertMessageID])
}

/** Check whether the message list for a session has been loaded into sync state. */
export function useSessionMessagesResolved(sessionID: string, directory?: string): boolean {
  return useDirectorySync(
    useCallback((state: State) => {
      if (!sessionID) return false
      return Object.prototype.hasOwnProperty.call(state.message, sessionID)
    }, [sessionID]),
    directory,
    useServerIdForSession(sessionID),
    sessionID,
  )
}

/** Check whether the message list has enough materialized data to render. */
export function useSessionMessagesRenderable(sessionID: string, directory?: string): boolean {
  return useDirectorySync(
    useCallback((state: State) => {
      if (!sessionID) return false
      return getSessionMaterializationStatus(state, sessionID).renderable
    }, [sessionID]),
    directory,
    useServerIdForSession(sessionID),
    sessionID,
  )
}

/** Get parts for a specific message */
export function useSessionParts(messageID: string, directory?: string) {
  return useDirectorySync(
    useCallback((state: State) => state.part[messageID] ?? EMPTY_PARTS, [messageID]),
    directory,
  )
}

/** Get status for a specific session */
export function useSessionStatus(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const childStatus = React.useSyncExternalStore(
    useCallback((notify: () => void) => {
      if (!sessionID) return () => undefined
      return store.subscribe(notify)
    }, [sessionID, store]),
    useCallback(() => {
      if (!sessionID) return undefined
      return store.getState().session_status?.[sessionID]
    }, [sessionID, store]),
    useCallback(() => {
      if (!sessionID) return undefined
      return store.getState().session_status?.[sessionID]
    }, [sessionID, store]),
  )
  const globalStatus = useGlobalSessionsStore(
    useCallback((state) => state.sessionStatuses.get(sessionID), [sessionID]),
  )
  return childStatus ?? globalStatus
}

/**
 * Timestamp (ms) of the last part event for a session. Cleared on
 * `session.idle` / `session.error`. Consumed by `useSessionActivity` to
 * keep Stop available when the server flips idle mid-stream.
 */
export function useSessionActivityTimestamp(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const getSnapshot = useCallback(() => {
    if (!sessionID) return undefined
    return store.getState().session_activity?.[sessionID]
  }, [sessionID, store])
  const subscribe = useCallback((notify: () => void) => {
    if (!sessionID) return () => undefined
    return store.subscribe(notify)
  }, [sessionID, store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Get permissions for a specific session */
export function useSessionPermissions(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const getSnapshot = useCallback(() => {
    if (!sessionID) return EMPTY_PERMISSION_REQUESTS
    return store.getState().permission[sessionID] ?? EMPTY_PERMISSION_REQUESTS
  }, [sessionID, store])
  const subscribe = useCallback((notify: () => void) => {
    if (!sessionID) return () => undefined
    return store.subscribe(notify)
  }, [sessionID, store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Get questions for a specific session */
export function useSessionQuestions(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const getSnapshot = useCallback(() => {
    if (!sessionID) return EMPTY_QUESTION_REQUESTS
    return store.getState().question[sessionID] ?? EMPTY_QUESTION_REQUESTS
  }, [sessionID, store])
  const subscribe = useCallback((notify: () => void) => {
    if (!sessionID) return () => undefined
    return store.subscribe(notify)
  }, [sessionID, store])
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useExistingSessionPermissions(sessionID: string, directory?: string) {
  const { childStores } = useSyncSystem()
  const serverId = useServerIdForSession(sessionID)
  const stores = serverId && serverId !== DEFAULT_SERVER_ID
    ? getSyncStoresForServer(serverId)
    : childStores
  const getSnapshot = useCallback(() => {
    if (!sessionID || !stores) return EMPTY_PERMISSION_REQUESTS
    if (directory) {
      return stores.getChild(directory)?.getState().permission[sessionID] ?? EMPTY_PERMISSION_REQUESTS
    }
    for (const store of stores.children.values()) {
      const requests = store.getState().permission[sessionID]
      if (requests) return requests
    }
    return EMPTY_PERMISSION_REQUESTS
  }, [directory, sessionID, stores])
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!stores) return () => undefined
      return directory
        ? stores.subscribeDirectory(directory, notify)
        : stores.subscribeAll(notify)
    },
    [directory, stores],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useExistingSessionQuestions(sessionID: string, directory?: string) {
  const { childStores } = useSyncSystem()
  const serverId = useServerIdForSession(sessionID)
  const stores = serverId && serverId !== DEFAULT_SERVER_ID
    ? getSyncStoresForServer(serverId)
    : childStores
  const getSnapshot = useCallback(() => {
    if (!sessionID || !stores) return EMPTY_QUESTION_REQUESTS
    if (directory) {
      return stores.getChild(directory)?.getState().question[sessionID] ?? EMPTY_QUESTION_REQUESTS
    }
    for (const store of stores.children.values()) {
      const requests = store.getState().question[sessionID]
      if (requests) return requests
    }
    return EMPTY_QUESTION_REQUESTS
  }, [directory, sessionID, stores])
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!stores) return () => undefined
      return directory
        ? stores.subscribeDirectory(directory, notify)
        : stores.subscribeAll(notify)
    },
    [directory, stores],
  )
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Get sessions list for a directory */
export function useSessions(directory?: string) {
  return useDirectorySync(
    useCallback((state: State) => state.session, []),
    directory,
  )
}

const getSidebarSessionSignature = (session: Session, stableUpdatedAt: number): string => {
  const directory = (session as Session & { directory?: string | null }).directory ?? ''
  const parentID = (session as Session & { parentID?: string | null }).parentID ?? ''
  const projectWorktree = (session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? ''
  const shared = session.share?.url ?? ''
  return [
    session.id,
    session.title ?? '',
    session.time?.created ?? 0,
    session.time?.archived ? 1 : 0,
    directory,
    parentID,
    projectWorktree,
    shared,
    stableUpdatedAt,
  ].join('|')
}

/** Get sessions stabilized for sidebar tree rendering */
export function useSidebarSessions(directory?: string): Session[] {
  const store = useDirectoryStore(directory)
  const cacheRef = React.useRef<{
    source: Session[]
    streamingSignature: string
    array: Session[]
    signatures: Map<string, string>
    sessionsById: Map<string, Session>
    stableUpdatedAtById: Map<string, number>
    streamingById: Map<string, boolean>
  } | null>(null)

  const getSnapshot = React.useCallback(() => {
    const state = store.getState()
    const source = state.session
    const cached = cacheRef.current
    const streamingSignature = source
      .map((session) => {
        const statusType = state.session_status?.[session.id]?.type
        const isStreaming = statusType === 'busy' || statusType === 'retry'
        return `${session.id}:${isStreaming ? 1 : 0}`
      })
      .join('|')

    if (cached && cached.source === source && cached.streamingSignature === streamingSignature) {
      return cached.array
    }

    const signatures = new Map<string, string>()
    const sessionsById = new Map<string, Session>()
    const stableUpdatedAtById = new Map<string, number>()
    const streamingById = new Map<string, boolean>()
    let changed = !cached || cached.array.length !== source.length

    const array = source.map((session) => {
      const rawUpdatedAt = Number(session.time?.updated ?? session.time?.created ?? 0)
      const statusType = state.session_status?.[session.id]?.type
      const isStreaming = statusType === 'busy' || statusType === 'retry'
      const cachedUpdatedAt = cached?.stableUpdatedAtById.get(session.id) ?? rawUpdatedAt
      const wasStreaming = cached?.streamingById.get(session.id) ?? false
      const stableUpdatedAt = isStreaming
        ? (wasStreaming ? cachedUpdatedAt : Math.max(rawUpdatedAt, cachedUpdatedAt, Date.now()))
        : Math.max(rawUpdatedAt, cachedUpdatedAt)
      const signature = getSidebarSessionSignature(session, stableUpdatedAt)
      signatures.set(session.id, signature)
      stableUpdatedAtById.set(session.id, stableUpdatedAt)
      streamingById.set(session.id, isStreaming)

      const cachedSession = cached?.sessionsById.get(session.id)
      if (
        cachedSession
        && cached?.signatures.get(session.id) === signature
      ) {
        sessionsById.set(session.id, cachedSession)
        return cachedSession
      }

      changed = true
      const nextSession = stableUpdatedAt === rawUpdatedAt
        ? session
        : {
            ...session,
            time: {
              ...session.time,
              updated: stableUpdatedAt,
            },
          }
      sessionsById.set(session.id, nextSession)
      return nextSession
    })

    if (!changed && cached) {
      cacheRef.current = {
        source,
        streamingSignature,
        array: cached.array,
        signatures,
        sessionsById: cached.sessionsById,
        stableUpdatedAtById,
        streamingById,
      }
      return cached.array
    }

    cacheRef.current = { source, streamingSignature, array, signatures, sessionsById, stableUpdatedAtById, streamingById }
    return array
  }, [store])

  return React.useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

/** Get one session by id for a directory */
export function useSession(sessionID?: string | null, directory?: string) {
  const { childStores } = useSyncSystem()
  const serverId = useServerIdForSession(sessionID ?? undefined)
  const getSnapshot = useCallback(() => {
    if (!sessionID) {
      return undefined
    }

    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const remoteStores = getSyncStoresForServer(serverId)
      if (!remoteStores) {
        return undefined
      }
      if (directory) {
        return remoteStores.getChild(directory)?.getState().session.find((session) => session.id === sessionID)
      }
      for (const store of remoteStores.children.values()) {
        const session = store.getState().session.find((candidate) => candidate.id === sessionID)
        if (session) {
          return session
        }
      }
      return undefined
    }

    if (directory) {
      return childStores.getChild(directory)?.getState().session.find((session) => session.id === sessionID)
    }

    return findLiveSession(getLiveStates(childStores), sessionID)
  }, [childStores, directory, serverId, sessionID])

  const subscribe = useCallback((notify: () => void) => {
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const remoteStores = getSyncStoresForServer(serverId)
      if (!remoteStores) {
        return () => undefined
      }
      if (directory) {
        return remoteStores.subscribeDirectory(directory, notify)
      }
      return remoteStores.subscribeAll(notify)
    }

    if (directory) {
      return childStores.subscribeDirectory(directory, notify)
    }

    return childStores.subscribeAll(notify)
  }, [childStores, directory, serverId])

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const readSessionDirectory = (session: Session | undefined): string | undefined => {
  const record = session as (Session & {
    directory?: string | null
    project?: { worktree?: string | null } | null
  }) | undefined
  if (typeof record?.directory === "string" && record.directory.trim().length > 0) {
    return normalizeEventDirectory(record.directory)
  }
  if (typeof record?.project?.worktree === "string" && record.project.worktree.trim().length > 0) {
    return normalizeEventDirectory(record.project.worktree)
  }
  return undefined
}

/** Get one session directory by id for a directory */
export function useSessionDirectory(sessionID?: string | null, directory?: string): string | undefined {
  const { childStores } = useSyncSystem()
  const serverId = useServerIdForSession(sessionID ?? undefined)
  const session = useSession(sessionID, directory)
  const directDirectory = readSessionDirectory(session)
  if (directDirectory) {
    return directDirectory
  }

  if (!sessionID) {
    return undefined
  }

  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remoteStores = getSyncStoresForServer(serverId)
    if (!remoteStores) {
      return undefined
    }
    if (directory) {
      return normalizeEventDirectory(directory)
    }
    for (const [candidateDirectory, store] of remoteStores.children.entries()) {
      if (store.getState().session.some((candidate) => candidate.id === sessionID)) {
        return normalizeEventDirectory(candidateDirectory)
      }
    }
    return undefined
  }

  if (directory) {
    return normalizeEventDirectory(directory)
  }

  for (const [candidateDirectory, store] of childStores.children.entries()) {
    if (store.getState().session.some((candidate) => candidate.id === sessionID)) {
      return normalizeEventDirectory(candidateDirectory)
    }
  }

  return undefined
}

/** Get the SDK client */
export function useSyncSDK() {
  return useSyncSystem().sdk
}

/** Get the current directory */
export function useSyncDirectory() {
  return useSyncSystem().directory
}

/** Get the child store manager (for advanced operations) */
export function useChildStoreManager() {
  return useSyncSystem().childStores
}

export type SessionTextMessage = {
  id: string
  role: string | null
  text: string
}

const getPartText = (part: Part): string => {
  if (part?.type !== "text") return ""
  const text = (part as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

const getConcatenatedTextFromParts = (parts: Part[]): string => {
  let text = ""
  for (const part of parts) {
    text += getPartText(part)
  }
  return text
}

const getFirstTextFromParts = (parts: Part[]): string => {
  for (const part of parts) {
    const text = getPartText(part)
    if (text.length > 0) return text
  }
  return ""
}

type SessionMessageRecord = { info: Message; parts: Part[] }
const EMPTY_SESSION_MESSAGE_RECORDS: SessionMessageRecord[] = []

type SessionMessageRecordsSnapshot = {
  sessionID: string
  sourceMessages: Message[]
  visibleMessages: Message[]
  revertMessageID?: string
  suspendPartUpdates: boolean
  suspendedPartUpdatesMessageID?: string
  steerSideChannelSignature: string
  list: SessionMessageRecord[]
  byId: Map<string, SessionMessageRecord>
}

const SESSION_MESSAGE_RECORDS_CACHE_MAX = 40
const VSCODE_SESSION_MESSAGE_RECORDS_CACHE_MAX = 4
const VSCODE_SESSION_MESSAGE_RECORDS_CACHE_MAX_MESSAGES = 30
const sessionMessageRecordsCache = new WeakMap<StoreApi<DirectoryStore>, Map<string, SessionMessageRecordsSnapshot>>()

const getSessionMessageRecordsCacheKey = (
  sessionID: string,
  suspendPartUpdates: boolean,
  suspendedPartUpdatesMessageID?: string,
): string => (
  `${sessionID}\u0000${suspendPartUpdates ? 1 : 0}\u0000${suspendedPartUpdatesMessageID ?? ""}`
)

const getSessionMessageRecordsCache = (store: StoreApi<DirectoryStore>): Map<string, SessionMessageRecordsSnapshot> => {
  let cache = sessionMessageRecordsCache.get(store)
  if (!cache) {
    cache = new Map()
    sessionMessageRecordsCache.set(store, cache)
  }
  return cache
}

const readCachedSessionMessageRecordsSnapshot = (
  store: StoreApi<DirectoryStore>,
  sessionID: string,
  suspendPartUpdates: boolean,
  suspendedPartUpdatesMessageID?: string,
): SessionMessageRecordsSnapshot | undefined => {
  const cache = sessionMessageRecordsCache.get(store)
  if (!cache) return undefined
  const key = getSessionMessageRecordsCacheKey(sessionID, suspendPartUpdates, suspendedPartUpdatesMessageID)
  const cached = cache.get(key)
  if (!cached) return undefined
  cache.delete(key)
  cache.set(key, cached)
  return cached
}

const rememberSessionMessageRecordsSnapshot = (
  store: StoreApi<DirectoryStore>,
  snapshot: SessionMessageRecordsSnapshot,
): void => {
  if (!snapshot.sessionID) return
  const cache = getSessionMessageRecordsCache(store)
  const key = getSessionMessageRecordsCacheKey(
    snapshot.sessionID,
    snapshot.suspendPartUpdates,
    snapshot.suspendedPartUpdatesMessageID,
  )
  if (isVSCodeRuntime() && snapshot.list.length > VSCODE_SESSION_MESSAGE_RECORDS_CACHE_MAX_MESSAGES) {
    cache.delete(key)
    return
  }
  cache.delete(key)
  cache.set(key, snapshot)
  const max = isVSCodeRuntime() ? VSCODE_SESSION_MESSAGE_RECORDS_CACHE_MAX : SESSION_MESSAGE_RECORDS_CACHE_MAX
  while (cache.size > max) {
    const oldest = cache.keys().next().value
    if (typeof oldest !== "string") break
    cache.delete(oldest)
  }
}

export function dropCachedSessionMessageRecordsSnapshots(
  store: StoreApi<DirectoryStore>,
  sessionIDs: Iterable<string>,
): void {
  const cache = sessionMessageRecordsCache.get(store)
  if (!cache) return
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${sessionID}\u0000`)) {
        cache.delete(key)
      }
    }
  }
}

const snapshotPartsMatchState = (snapshot: SessionMessageRecordsSnapshot, state: State): boolean => {
  for (const record of snapshot.list) {
    if (
      snapshot.suspendPartUpdates
      && (
        !snapshot.suspendedPartUpdatesMessageID
        || record.info.id === snapshot.suspendedPartUpdatesMessageID
      )
    ) {
      continue
    }
    if ((state.part[record.info.id] ?? EMPTY_PARTS) !== record.parts) {
      return false
    }
  }

  return true
}

const getReusableSessionMessageRecordsSnapshot = (
  store: StoreApi<DirectoryStore>,
  state: State,
  sessionID: string,
  suspendPartUpdates: boolean,
  suspendedPartUpdatesMessageID?: string,
): SessionMessageRecordsSnapshot | undefined => {
  const cached = readCachedSessionMessageRecordsSnapshot(
    store,
    sessionID,
    suspendPartUpdates,
    suspendedPartUpdatesMessageID,
  )
  if (!cached) return undefined
  const steerSideChannelSignature = getSteerSideChannelSignature(sessionID)
  const sourceMessages = state.message[sessionID] ?? EMPTY_MESSAGES
  const session = state.session.find((candidate) => candidate.id === sessionID)
  const revertMessageID = (session as { revert?: { messageID?: string } } | undefined)?.revert?.messageID
  if (
    cached.sourceMessages === sourceMessages
    && cached.revertMessageID === revertMessageID
    && cached.suspendPartUpdates === suspendPartUpdates
    && cached.suspendedPartUpdatesMessageID === suspendedPartUpdatesMessageID
    && cached.steerSideChannelSignature === steerSideChannelSignature
    && snapshotPartsMatchState(cached, state)
  ) {
    return cached
  }
  return undefined
}

function getVisibleMessagesForSession(state: State, sessionID: string, previous?: SessionMessageRecordsSnapshot): {
  sourceMessages: Message[]
  visibleMessages: Message[]
  revertMessageID?: string
} {
  const sourceMessages = state.message[sessionID] ?? EMPTY_MESSAGES
  const session = state.session.find((candidate) => candidate.id === sessionID)
  const revertMessageID = (session as { revert?: { messageID?: string } } | undefined)?.revert?.messageID

  if (
    previous
    && previous.sourceMessages === sourceMessages
    && previous.revertMessageID === revertMessageID
  ) {
    return {
      sourceMessages,
      visibleMessages: previous.visibleMessages,
      revertMessageID,
    }
  }

  return {
    sourceMessages,
    visibleMessages: revertMessageID ? sourceMessages.filter((message) => message.id < revertMessageID) : sourceMessages,
    revertMessageID,
  }
}

export function buildSessionMessageRecordsSnapshot(
  state: State,
  sessionID: string,
  previous?: SessionMessageRecordsSnapshot,
  suspendPartUpdates = false,
  suspendedPartUpdatesMessageID?: string,
): SessionMessageRecordsSnapshot {
  const { sourceMessages, visibleMessages, revertMessageID } = getVisibleMessagesForSession(state, sessionID, previous)
  const steerSideChannelSignature = getSteerSideChannelSignature(sessionID)
  const sideChannelRecords = getMissingSteerSideChannelRecords(sessionID, visibleMessages)
  const sideChannelParts = new Map(sideChannelRecords.map((record) => [record.info.id, record.parts] as const))
  const effectiveMessages = sideChannelRecords.length === 0
    ? visibleMessages
    : [...visibleMessages, ...sideChannelRecords.map((record) => record.info)].sort((left, right) => left.id.localeCompare(right.id))
  const nextById = new Map<string, SessionMessageRecord>()
  const nextList = effectiveMessages.map((message) => {
    const previousRecord = previous?.byId.get(message.id)
    const shouldSuspendParts = suspendPartUpdates
      && previousRecord
      && (!suspendedPartUpdatesMessageID || message.id === suspendedPartUpdatesMessageID)
    const parts = shouldSuspendParts
      ? previousRecord.parts
      : (sideChannelParts.get(message.id) ?? state.part[message.id] ?? EMPTY_PARTS)

    const nextRecord = previousRecord && previousRecord.info === message && previousRecord.parts === parts
      ? previousRecord
      : { info: message, parts }

    nextById.set(message.id, nextRecord)
    return nextRecord
  })

  const unchanged = Boolean(previous)
    && previous?.visibleMessages === effectiveMessages
    && previous.suspendPartUpdates === suspendPartUpdates
    && previous.suspendedPartUpdatesMessageID === suspendedPartUpdatesMessageID
    && previous.steerSideChannelSignature === steerSideChannelSignature
    && previous.list.length === nextList.length
    && previous.list.every((record, index) => record === nextList[index])

  if (unchanged && previous) {
    return previous
  }

  return {
    sessionID,
    sourceMessages,
    visibleMessages: effectiveMessages,
    revertMessageID,
    suspendPartUpdates,
    suspendedPartUpdatesMessageID,
    steerSideChannelSignature,
    list: nextList,
    byId: nextById,
  }
}

export function useSessionMessageCount(sessionID: string, directory?: string): number {
  return useDirectorySync(
    useCallback((state: State) => {
      if (!sessionID) return 0
      return state.message[sessionID]?.length ?? 0
    }, [sessionID]),
    directory,
    useServerIdForSession(sessionID),
    sessionID,
  )
}

export function useSessionTextMessages(sessionID: string, directory?: string): SessionTextMessage[] {
  const records = useSessionMessageRecords(sessionID, directory)

  return useMemo(
    () => records.map((record) => ({
      id: record.info.id,
      role: typeof record.info.role === "string" ? record.info.role : null,
      text: getConcatenatedTextFromParts(record.parts),
    })),
    [records],
  )
}

export function useUserMessageHistory(sessionID: string, directory?: string): string[] {
  const records = useSessionMessageRecords(sessionID, directory)
  const userMessages = useMemo(
    () => records.filter((record) => isRealUserMessage(record.info, record.parts)),
    [records],
  )

  return useMemo(() => {
    const history: string[] = []
    for (let index = userMessages.length - 1; index >= 0; index -= 1) {
      const message = userMessages[index]
      const text = getFirstTextFromParts(message.parts)
      if (text.length > 0) {
        history.push(text)
      }
    }
    return history
  }, [userMessages])
}

/**
 * Get messages for a session in the old {info, parts}[] format.
 * Uses visible messages (filtered by revert state).
 *
 * Uses a ref-stable parts lookup that only triggers re-renders when
 * a part array for one of our displayed messages actually changes.
 */
export function useSessionMessageRecords(
  sessionID: string,
  directory?: string,
  options?: { suspendPartUpdates?: boolean; suspendPartUpdatesForMessageId?: string | null },
) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)
  const snapshotRef = useRef<SessionMessageRecordsSnapshot>({
    sessionID,
    sourceMessages: EMPTY_MESSAGES,
    visibleMessages: EMPTY_MESSAGES,
    revertMessageID: undefined,
    suspendPartUpdates: Boolean(options?.suspendPartUpdates),
    suspendedPartUpdatesMessageID: options?.suspendPartUpdatesForMessageId ?? undefined,
    steerSideChannelSignature: "",
    list: [],
    byId: new Map(),
  })

  const getSnapshot = useCallback(() => {
    if (!sessionID) {
      return EMPTY_SESSION_MESSAGE_RECORDS
    }

    const state = store.getState()
    const suspendPartUpdates = Boolean(options?.suspendPartUpdates)
    const suspendedPartUpdatesMessageID = options?.suspendPartUpdatesForMessageId ?? undefined
    const reusableSnapshot = getReusableSessionMessageRecordsSnapshot(
      store,
      state,
      sessionID,
      suspendPartUpdates,
      suspendedPartUpdatesMessageID,
    )
    if (reusableSnapshot) {
      snapshotRef.current = reusableSnapshot
      return reusableSnapshot.list
    }

    const previousSnapshot = snapshotRef.current.sessionID === sessionID
      ? snapshotRef.current
      : readCachedSessionMessageRecordsSnapshot(store, sessionID, suspendPartUpdates, suspendedPartUpdatesMessageID)

    const nextSnapshot = buildSessionMessageRecordsSnapshot(
      state,
      sessionID,
      previousSnapshot,
      suspendPartUpdates,
      suspendedPartUpdatesMessageID,
    )
    snapshotRef.current = nextSnapshot
    rememberSessionMessageRecordsSnapshot(store, nextSnapshot)
    return nextSnapshot.list
  }, [options?.suspendPartUpdates, options?.suspendPartUpdatesForMessageId, sessionID, store])

  const subscribe = useCallback((notify: () => void) => {
    if (!sessionID) return () => undefined
    return store.subscribe(notify)
  }, [sessionID, store])

  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Ensures a session's messages are loaded into the sync store.
 * If the session exists in state.session but messages haven't been fetched
 * (state.message[sessionID] is absent), triggers a background API fetch.
 *
 * This covers the case where a user navigates to an old parent session
 * whose child session messages were never loaded — bootstrap only loads
 * session metadata, not messages.
 */

// Module-level in-flight tracking for useEnsureSessionMessages.
// Prevents redundant parallel fetches when multiple component instances
// (e.g. multiple ToolParts) request the same session's messages.
const _ensureMessagesLoading = new Set<string>()

export function useEnsureSessionMessages(sessionID: string, directory?: string) {
  const store = useDirectoryStore(directory, useServerIdForSession(sessionID), sessionID)

  React.useEffect(() => {
    if (!sessionID) return

    const state = store.getState()
    // Already loaded into a renderable message/part snapshot — nothing to do.
    if (getSessionMaterializationStatus(state, sessionID).renderable) return
    // Session doesn't exist — nothing to load
    if (!state.session.some((s) => s.id === sessionID)) return

    const dir = directory ?? opencodeClient.getDirectory()
    const loadingKey = `${dir ?? ""}:${sessionID}`
    // Already loading this session for this directory
    if (_ensureMessagesLoading.has(loadingKey)) return

    _ensureMessagesLoading.add(loadingKey)

    void (async () => {
      try {
        await materializeSessionFromServer(dir ?? "", sessionID, store, serverRegistry.getServerForSession(sessionID))
      } catch {
        // Transient failure — next navigation or reconnect will retry
      } finally {
        _ensureMessagesLoading.delete(loadingKey)
      }
    })()
  }, [sessionID, store, directory])
}

/**
 * Determines if a session is actively working.
 * Checks session_status and only falls back to incomplete assistant messages
 * when authoritative status is missing.
 * Returns false when permissions are pending (permission indicator takes priority).
 */
export function useIsSessionWorking(sessionID: string, directory?: string): boolean {
  const status = useSessionStatus(sessionID, directory)
  const permissions = useSessionPermissions(sessionID, directory)
  const messages = useSessionMessages(sessionID, directory)

  return useMemo(() => {
    // Permissions pending → not "working" (show permission indicator instead)
    if (permissions.length > 0) return false

    // Check session_status
    const hasAuthoritativeStatus = status !== undefined
    const statusWorking = hasAuthoritativeStatus && status.type !== "idle"

    // Check for incomplete assistant message (fallback if status event delayed)
    let hasPendingAssistant = false
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "user") {
        break
      }
      if (m.role === "assistant" && !hasTerminalMessageSignal(m as TerminalMessageSignalInfo)) {
        hasPendingAssistant = true
        break
      }
    }

    if (hasAuthoritativeStatus) return statusWorking
    return hasPendingAssistant
  }, [status, permissions, messages])
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_PARTS: Part[] = []
const EMPTY_PERMISSION_REQUESTS: PermissionRequest[] = []
const EMPTY_QUESTION_REQUESTS: QuestionRequest[] = []
