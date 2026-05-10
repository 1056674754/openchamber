/**
 * Session actions — SDK-calling operations for session management.
 * Replaces the action methods from the old useSessionStore.
 */

import type { OpencodeClient, Session, Message, Part } from "@opencode-ai/sdk/v2/client"
import { Binary } from "./binary"
import { useSessionUIStore } from "./session-ui-store"
import { useInputStore } from "./input-store"
import type { AttachedFile } from "@/stores/types/sessionTypes"
import type { ChildStoreManager } from "./child-store"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { registerSessionDirectory } from "./sync-refs"
import { isSyntheticPart } from "@/lib/messages/synthetic"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { getSyncStoresForServer } from "./multi-server-registry"
import { useProjectsStore } from "@/stores/useProjectsStore"

// Reference set by SyncProvider — allows actions to access SDK and stores
let _sdk: OpencodeClient | null = null
let _childStores: ChildStoreManager | null = null
let _getDirectory: () => string = () => ""
let _optimisticAdd: ((input: { sessionID: string; message: Message; parts: Part[] }) => void) | null = null
let _optimisticRemove: ((input: { sessionID: string; messageID: string }) => void) | null = null

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
  add: (input: { sessionID: string; message: Message; parts: Part[] }) => void,
  remove: (input: { sessionID: string; messageID: string }) => void,
) {
  _optimisticAdd = add
  _optimisticRemove = remove
}

function sdk() {
  if (!_sdk) throw new Error("SDK not initialized — is SyncProvider mounted?")
  return _sdk
}

function dirStore() {
  if (!_childStores) throw new Error("Child stores not initialized")
  const d = _getDirectory()
  if (!d) throw new Error("No current directory")
  return _childStores.ensureChild(d)
}

function dir() {
  return _getDirectory() || undefined
}

const normalizeDirectoryKey = (directory: string): string =>
  directory.replace(/\\/g, "/").replace(/\/+$/, "") || "/"

function findProjectForDirectory(directory: string) {
  const normalizedDir = normalizeDirectoryKey(directory)
  const projects = useProjectsStore.getState().projects
  let best: typeof projects[number] | null = null
  for (const project of projects) {
    const projectPath = normalizeDirectoryKey(project.path)
    if (normalizedDir !== projectPath && !normalizedDir.startsWith(`${projectPath}/`)) {
      continue
    }
    if (!best || projectPath.length > normalizeDirectoryKey(best.path).length) {
      best = project
    }
  }
  return best
}

/** Get the SDK client for a session's server. Falls back to default server. */
function sdkForSession(sessionId?: string | null): OpencodeClient {
  if (sessionId) {
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

/** Resolve the correct SDK client for a directory by looking up its project's serverId. */
export function resolveSdkForDirectory(directory: string): OpencodeClient {
  const normalizedDir = normalizeDirectoryKey(directory)
  const project = findProjectForDirectory(normalizedDir)
  if (project?.serverId && project.serverId !== DEFAULT_SERVER_ID) {
    const conn = serverRegistry.get(project.serverId)
    if (conn) {
      console.log(`[resolveSdk] dir="${normalizedDir}" → server=${project.serverId} url=${conn.config.baseUrl}`)
      return conn.client
    }
    throw new Error(`Remote server "${project.serverId}" is not available for ${normalizedDir}`)
  }
  // Fallback: use the DEFAULT server's client from the registry, NOT the module-level
  // _sdk which may have been overwritten by a remote SyncProvider's setActionRefs.
  const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConn) return defaultConn.client
  return sdk()
}

/** Resolve the base URL (including /api suffix) for a directory's server.
 *  Returns undefined if the directory belongs to the local default server. */
export function resolveBaseUrl(directory: string): string | undefined {
  const normalizedDir = normalizeDirectoryKey(directory)
  const project = findProjectForDirectory(normalizedDir)
  if (!project?.serverId || project.serverId === DEFAULT_SERVER_ID) return undefined
  const conn = serverRegistry.get(project.serverId)
  if (!conn) throw new Error(`Remote server "${project.serverId}" is not available for ${normalizedDir}`)
  return conn.config.baseUrl
}

export function resolveBaseUrlForSession(sessionId: string | null | undefined, directory?: string | null): string | undefined {
  if (sessionId) {
    const serverId = serverRegistry.getServerForSession(sessionId)
    if (serverId) {
      if (serverId === DEFAULT_SERVER_ID) return undefined
      const conn = serverRegistry.get(serverId)
      if (!conn) throw new Error(`Remote server "${serverId}" is not available for session ${sessionId}`)
      return conn.config.baseUrl
    }
  }
  return directory ? resolveBaseUrl(directory) : undefined
}

/** Resolve the base API URL (raw origin, no /api suffix) for a directory's server. */
export function resolveApiUrl(directory: string): string | undefined {
  const normalizedDir = normalizeDirectoryKey(directory)
  const project = findProjectForDirectory(normalizedDir)
  if (!project?.serverId || project.serverId === DEFAULT_SERVER_ID) return undefined
  const conn = serverRegistry.get(project.serverId)
  if (!conn) throw new Error(`Remote server "${project.serverId}" is not available for ${normalizedDir}`)
  // Extract raw origin from the baseUrl (which includes /api suffix)
  try {
    return new URL(conn.config.baseUrl).origin
  } catch {
    return undefined
  }
}

/** Get the child store manager for a session's server. Falls back to default. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

/** Get the directory store for a session. Uses the remote server's child stores
    (keyed by "" since MultiServerSyncLayer mounts with directory="") for remote sessions,
    or the current directory's store for local sessions. Falls back to dirStore(). */
function storeForSession(sessionId: string | null | undefined): ReturnType<ChildStoreManager["ensureChild"]> {
  if (sessionId) {
    const serverId = serverRegistry.getServerForSession(sessionId)
    const sessionDirectory = getSessionDirectory(sessionId)
    if (serverId && serverId !== DEFAULT_SERVER_ID) {
      const remoteStores = getSyncStoresForServer(serverId)
      if (remoteStores) {
        const store = sessionDirectory
          ? remoteStores.getChild(sessionDirectory)
          : remoteStores.getChild("")
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
  if (!sessionId) return dirStore()
  throw new Error(`Directory store for session ${sessionId} is not available`)
}

function connectionLostError(): Error {
  const { hasEverConnected, lastDisconnectReason } = useConfigStore.getState()
  const suffix = lastDisconnectReason
    ? ` (${lastDisconnectReason})`
    : hasEverConnected
      ? ""
      : " (never connected)"
  return new Error(`Connection lost${suffix}. Please wait for reconnection.`)
}

// Wait briefly for the pipeline to re-establish connection before failing a
// send. Transient reconnects (heartbeat race, WS→SSE fallback, brief network
// blip) otherwise surface as a hard "Connection lost" toast even though the
// pipeline recovers within a second. While waiting, run bounded health probes
// inside the same grace window so stale disconnected state can recover quickly.
const CONNECTION_GRACE_MS = 2000
export async function waitForConnectionOrThrow(): Promise<void> {
  const deadline = Date.now() + CONNECTION_GRACE_MS
  while (Date.now() < deadline) {
    if (useConfigStore.getState().isConnected) return
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) break
    if (await useConfigStore.getState().probeConnection({ timeoutMs: Math.min(500, remainingMs) })) return
    const sleepMs = Math.min(100, deadline - Date.now())
    if (sleepMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, sleepMs))
    }
  }
  throw connectionLostError()
}

function getSessionDirectory(sessionId: string): string | undefined {
  const uiDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId)
  if (uiDirectory) return uiDirectory

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
    return resolveSdkForDirectory(directory)
  }
  throw new Error(`Reply target directory for session ${sessionId ?? "(unknown)"} is not available`)
}

function resolveDirectoryForBlockingRequest(
  type: "permission" | "question",
  sessionId: string,
  requestId: string,
): string | null {
  const stores = _childStores
  if (!stores || !requestId) {
    return null
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

  const sessionDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId)
  if (sessionDirectory) {
    return sessionDirectory
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
    return resolveSdkForDirectory(requestDirectory)
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

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createSession(
  title?: string,
  directoryOverride?: string | null,
  parentID?: string | null,
): Promise<Session | null> {
  try {
    const fallbackDir = directoryOverride ?? dir()
    if (!fallbackDir) {
      console.error("[session-actions] createSession: no directory available")
      return null
    }

    const client = resolveSdkForDirectory(fallbackDir)
    const result = await client.session.create({
      directory: fallbackDir,
      title,
      parentID: parentID ?? undefined,
    })
    const session = result.data
    if (!session) return null

      const sessionDirectory = (session as { directory?: string }).directory ?? directoryOverride ?? null
      // Pre-populate routing index so SSE events arriving before session.created
      // can be routed to the correct child store
      if (sessionDirectory) {
        registerSessionDirectory(session.id, sessionDirectory)
      }

      const normalizedDir = fallbackDir.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
      const project = useProjectsStore.getState().projects.find(
        (p) => p.path === normalizedDir && p.serverId && p.serverId !== DEFAULT_SERVER_ID,
      )
      if (project?.serverId) {
        serverRegistry.indexSession(session.id, project.serverId)
      }

      useSessionUIStore.getState().setCurrentSession(session.id, sessionDirectory)
      useSessionUIStore.getState().markSessionAsOpenChamberCreated(session.id)
      useGlobalSessionsStore.getState().upsertSession(session)
      return session
  } catch (error) {
    console.error("[session-actions] createSession failed", error)
    return null
  }
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function deleteSession(sessionId: string, _options?: Record<string, unknown>): Promise<boolean> {
  const sessionDirectory = requireSessionDirectory(sessionId, "deleteSession")
  // Remove from UI immediately, rollback on error
  let snapshot = optimisticRemoveSession(sessionId, sessionDirectory)
  let removedFromDir: string | null = snapshot ? (sessionDirectory ?? null) : null

  // If the session wasn't in the resolved directory (e.g. archived session
  // whose original child store was disposed), search all child stores.
  if (!snapshot && _childStores) {
    for (const [dir, store] of _childStores.children.entries()) {
      const current = store.getState()
      const sessions = [...current.session]
      const result = Binary.search(sessions, sessionId, (s) => s.id)
      if (result.found) {
        snapshot = current.session
        sessions.splice(result.index, 1)
        store.setState({ session: sessions })
        removedFromDir = dir
        break
      }
    }
  }

  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    await sdkForSession(sessionId).session.delete({ sessionID: sessionId, directory: sessionDirectory })
    useGlobalSessionsStore.getState().removeSessions([sessionId])
    return true
  } catch (error) {
    console.error("[session-actions] deleteSession failed", error)
    if (snapshot && removedFromDir) {
      try {
        getDirectoryStore(removedFromDir).setState({ session: snapshot })
      } catch {
        // child store may have been disposed since — ignore rollback
      }
    }
    return false
  }
}

/** Delete a session specifying which directory it lives in. Used by agent groups for cross-directory deletes. */
export async function deleteSessionInDirectory(sessionId: string, directory: string): Promise<boolean> {
  if (!_childStores) return false
  const store = _childStores.ensureChild(directory)
  const current = store.getState()
  const sessions = [...current.session]
  const result = Binary.search(sessions, sessionId, (s) => s.id)
  let snapshot: Session[] | null = null
  if (result.found) {
    snapshot = current.session
    sessions.splice(result.index, 1)
    store.setState({ session: sessions })
  }
  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) ui.setCurrentSession(null)
  try {
    await sdkForSession(sessionId).session.delete({ sessionID: sessionId, directory })
    useGlobalSessionsStore.getState().removeSessions([sessionId])
    return true
  } catch (error) {
    console.error("[session-actions] deleteSessionInDirectory failed", error)
    if (snapshot) store.setState({ session: snapshot })
    return false
  }
}

export async function archiveSession(sessionId: string): Promise<boolean> {
  const sessionDirectory = requireSessionDirectory(sessionId, "archiveSession")
  const snapshot = optimisticRemoveSession(sessionId, sessionDirectory)
  const ui = useSessionUIStore.getState()
  if (ui.currentSessionId === sessionId) {
    ui.setCurrentSession(null)
  }
  try {
    const archivedAt = Date.now()
    await sdkForSession(sessionId).session.update({ sessionID: sessionId, directory: sessionDirectory, time: { archived: archivedAt } })
    useGlobalSessionsStore.getState().archiveSessions([sessionId], archivedAt)
    return true
  } catch (error) {
    console.error("[session-actions] archiveSession failed", error)
    if (snapshot) getDirectoryStore(sessionDirectory).setState({ session: snapshot })
    return false
  }
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "updateSessionTitle")
  const result = await sdkForSession(sessionId).session.update({ sessionID: sessionId, directory: sessionDirectory, title })
  if (result.data) {
    useGlobalSessionsStore.getState().upsertSession(result.data)
  }
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
  /** The actual API call — receives the optimistic messageID so the server can use the same ID */
  send: (messageID: string) => Promise<void>
}): Promise<void> {
  if (!_optimisticAdd || !_optimisticRemove) {
    throw new Error("Optimistic refs not set — is useSync() mounted?")
  }

  await waitForConnectionOrThrow()

  const store = storeForSession(input.sessionId)

  // Abort if session is already busy (e.g. running in another window like mini chat).
  // This prevents message loss by stopping the current operation before sending a new one.
  const currentStatus = store.getState().session_status[input.sessionId]
  if (currentStatus && currentStatus.type !== "idle") {
    try {
      const sessionDirectory = requireSessionDirectory(input.sessionId, "optimisticSend")
      await sdkForSession(input.sessionId).session.abort({ sessionID: input.sessionId, directory: sessionDirectory })
    } catch {
      // ignore abort errors — proceed with send regardless
    }
  }
  const messageID = ascendingId("msg")
  const textPartId = ascendingId("prt")

  const optimisticParts: Part[] = [
    { id: textPartId, type: "text", text: input.content } as Part,
  ]
  if (input.files) {
    for (const f of input.files) {
      optimisticParts.push({ id: ascendingId("prt"), type: "file", mime: f.mime, url: f.url, filename: f.filename } as Part)
    }
  }

  const optimisticMessage = {
    id: messageID,
    role: "user" as const,
    sessionID: input.sessionId,
    parentID: "",
    modelID: input.modelID,
    providerID: input.providerID,
    system: "",
    agent: input.agent ?? "",
    model: `${input.providerID}/${input.modelID}`,
    metadata: {} as Record<string, unknown>,
    time: { created: Date.now(), completed: 0 },
  } as unknown as Message

  // Insert into store + register in shadow Map (for mergeOptimisticPage cleanup)
  _optimisticAdd({
    sessionID: input.sessionId,
    message: optimisticMessage,
    parts: optimisticParts,
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
    await input.send(messageID)
  } catch (error) {
    // Rollback via optimistic infrastructure
    _optimisticRemove({
      sessionID: input.sessionId,
      messageID,
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

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

export async function abortCurrentOperation(sessionId: string): Promise<void> {
  // Resolve all possible directory candidates.
  // OpenCode's InstanceState is keyed by resolved directory — if abort sends a
  // different string than what the prompt used, the server finds no runner and
  // silently no-ops. We collect both the "live" directory (same source as prompt)
  // and the session-mapped directory to cover mismatches.
  const liveDirectory = _getDirectory() || undefined
  let sessionDirectory: string | undefined
  try {
    sessionDirectory = requireSessionDirectory(sessionId, "abortCurrentOperation")
  } catch {
    // ignore — liveDirectory is the primary source
  }

  // Deduplicate: if both resolve to the same string, only send once.
  const directories = new Set<string>()
  if (liveDirectory) directories.add(liveDirectory)
  if (sessionDirectory) directories.add(sessionDirectory)

  if (directories.size === 0) {
    console.error("[session-actions] abort: no directory available at all")
    useGlobalSessionsStore.getState().upsertStatus(sessionId, { type: "idle" })
    return
  }

  const client = sdkForSession(sessionId)

  const sendAbort = (directory: string) =>
    client.session.abort({ sessionID: sessionId, directory })

  console.info("[session-actions] abort sending", {
    sessionId,
    directories: [...directories],
  })

  // Send abort for each unique directory candidate to ensure we hit the
  // correct InstanceState entry regardless of path normalization differences.
  const abortPromises = [...directories].map((dir) =>
    sendAbort(dir).catch((error) => {
      console.error("[session-actions] abort call failed", { directory: dir, error })
    }),
  )
  await Promise.all(abortPromises)

  // Retry abort with escalating delays — OpenCode may not stop on the first
  // attempt when mid-tool-execution or with queued tool calls.
  const retryDelays = [600, 1500, 3500]
  for (const delay of retryDelays) {
    setTimeout(() => {
      try {
        const store = storeForSession(sessionId)
        const current = store.getState()
        if (current.session_status[sessionId]?.type !== "idle") {
          console.info("[session-actions] abort retry", { sessionId, delay })
          for (const dir of directories) {
            void sendAbort(dir).catch(() => {})
          }
        }
      } catch {
        for (const dir of directories) {
          void sendAbort(dir).catch(() => {})
        }
      }
    }, delay)
  }

  // Update global store optimistically so sidebar stops showing the spinner.
  // Do NOT update child store — keep the stop button visible in case OpenCode
  // doesn't actually stop and the user needs to press stop again.
  useGlobalSessionsStore.getState().upsertStatus(sessionId, { type: "idle" })
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export async function respondToPermission(
  sessionId: string,
  requestId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory = requireBlockingRequestDirectory("permission", sessionId, requestId)
  const result = await getRequestReplyClient("permission", sessionId, requestId).permission.reply({
    requestID: requestId,
    reply: response,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Permission reply failed")
  }
}

export async function dismissPermission(
  sessionId: string,
  requestId: string,
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory = requireBlockingRequestDirectory("permission", sessionId, requestId)
  const result = await getRequestReplyClient("permission", sessionId, requestId).permission.reply({
    requestID: requestId,
    reply: "reject",
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Permission dismissal failed")
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function respondToQuestion(
  sessionId: string,
  requestId: string,
  answers: string[] | string[][],
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory = requireBlockingRequestDirectory("question", sessionId, requestId)
  const result = await getRequestReplyClient("question", sessionId, requestId).question.reply({
    requestID: requestId,
    answers: answers as Array<Array<string>>,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question reply failed")
  }
}

export async function rejectQuestion(
  sessionId: string,
  requestId: string,
): Promise<void> {
  await waitForConnectionOrThrow()
  const directory = requireBlockingRequestDirectory("question", sessionId, requestId)
  const result = await getRequestReplyClient("question", sessionId, requestId).question.reject({
    requestID: requestId,
    ...(directory ? { directory } : {}),
  })
  if (!result.data) {
    throw new Error("Question rejection failed")
  }
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

/**
 * Convert file parts from a stored message into AttachedFile entries
 * suitable for the input store, so the user can re-send after revert/fork.
 *
 * Only data URLs (base64) and file:// URLs are supported for reconstruction;
 * http(s) URLs produce a zero-byte placeholder File that still carries the
 * original URL for submission via the server path.
 */
async function extractAttachedFilesFromParts(parts: Part[]): Promise<AttachedFile[]> {
  const fileParts = parts.filter((p) => p.type === "file" && !isSyntheticPart(p))
  const results: AttachedFile[] = []
  for (const raw of fileParts) {
    const part = raw as Part & { mime?: string; filename?: string; url?: string }
    const url = part.url ?? ""
    const mime = part.mime ?? "application/octet-stream"
    const filename = part.filename ?? "file"
    if (!url) continue

    const id = `revert-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let file: File
    let size = 0
    try {
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("http:") || url.startsWith("https:")) {
        const response = await fetch(url)
        const blob = await response.blob()
        file = new File([blob], filename, { type: mime })
        size = blob.size
      } else {
        // file://, server:// or other — keep as a lightweight placeholder; submission uses the URL
        file = new File([], filename, { type: mime })
        size = 0
      }
    } catch {
      // Reconstruction failed — fall back to placeholder so user still sees the attachment
      file = new File([], filename, { type: mime })
      size = 0
    }

    results.push({
      id,
      file,
      dataUrl: url,
      mimeType: mime,
      filename,
      size,
      source: "local",
    })
  }
  return results
}

/**
 * Revert to a specific user message.
 *
 * 1. Abort if session is busy
 * 2. Extract text + file attachments from the target message for input restoration
 * 3. Optimistically set revert marker so messages hide immediately
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
  console.log('[revertToMessage] messageId=', messageId, 'targetMsg.role=', targetMsg?.role, 'targetParts.length=', targetParts.length, 'messageText=', JSON.stringify(messageText))
  console.log('[revertToMessage] messages.length=', messages.length, 'all message ids=', messages.map(m => m.id))
  console.log('[revertToMessage] all part keys=', Object.keys(state.part))
  console.log('[revertToMessage] state.part[messageId]=', state.part[messageId])

  // Optimistically remove reverted messages + set marker
  const prevRevert = (() => {
    const s = state.session.find((s) => s.id === sessionId)
    return (s as Session & { revert?: unknown })?.revert
  })()
  const sessions = [...state.session]
  const sessionIdx = sessions.findIndex((s) => s.id === sessionId)

  // Remove messages at and after the revert point from the store
  const prevMessages = state.message[sessionId] ?? []
  const prevPart = { ...state.part }
  const keptMessages = prevMessages.filter((m) => m.id < messageId)
  const removedMessages = prevMessages.filter((m) => m.id >= messageId)
  for (const m of removedMessages) {
    delete prevPart[m.id]
  }

  const patch: Record<string, unknown> = {
    message: { ...state.message, [sessionId]: keptMessages },
    part: prevPart,
  }

  if (sessionIdx >= 0) {
    sessions[sessionIdx] = { ...sessions[sessionIdx], revert: { messageID: messageId } } as Session
    patch.session = sessions
  }

  if (messageText) {
    console.log('[revertToMessage] setting pendingInputText=', JSON.stringify(messageText))
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  } else if (targetParts.length > 0) {
    console.log('[revertToMessage] attachments only, clearing pendingInputText')
    // Reverted message had attachments but no text — clear any stale pending
    // text so it doesn't leak from a prior operation into the restored input.
    useInputStore.setState({
      pendingInputText: "",
      pendingInputMode: "replace" as const,
    })
  } else {
    console.log('[revertToMessage] no text and no attachments — not touching pendingInputText')
  }

  store.setState(patch)
  console.log('[revertToMessage] after store.setState, pendingInputText is now=', useInputStore.getState().pendingInputText)

  // Restore file attachments (e.g., images) so the user sees and can re-send them.
  // This runs async — images hit the input after text but before/during the SDK call.
  if (targetParts.length > 0) {
    void extractAttachedFilesFromParts(targetParts).then((files) => {
      if (files.length > 0) {
        useInputStore.getState().setAttachedFiles(files)
      }
    })
  }

  // Call SDK and merge authoritative result into store
  try {
    const result = await sdkForSession(sessionId).session.revert({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
    if (result.data) {
      const current = store.getState()
      const updated = [...current.session]
      const idx = updated.findIndex((s) => s.id === sessionId)
      if (idx >= 0) {
        updated[idx] = result.data
        store.setState({ session: updated })
      }
    }
  } catch (err) {
    // Rollback: restore removed messages + revert marker
    const current = store.getState()
    const rollback = [...current.session]
    const idx = rollback.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      rollback[idx] = { ...rollback[idx], revert: prevRevert } as Session
    }
    store.setState({
      session: rollback,
      message: { ...current.message, [sessionId]: prevMessages },
      part: { ...current.part, ...Object.fromEntries(removedMessages.map((m) => [m.id, state.part[m.id] ?? []])) },
    })
    throw err
  }
}

/**
 * Unrevert — restore all previously reverted messages.
 * Restore all previously reverted messages. Aborts if busy, merges result.
 */
export async function unrevertSession(sessionId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "unrevertSession")
  const store = storeForSession(sessionId)
  const state = store.getState()

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
  if (result.data) {
    const current = store.getState()
    const sessions = [...current.session]
    const idx = sessions.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      sessions[idx] = result.data
      store.setState({ session: sessions })
    }
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
export async function forkFromMessage(sessionId: string, messageId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "forkFromMessage")
  const store = storeForSession(sessionId)
  const state = store.getState()

  const parts = state.part[messageId] ?? []
  const messageText = extractUserMessageText(parts)

  const result = await sdkForSession(sessionId).session.fork({ sessionID: sessionId, directory: sessionDirectory, messageID: messageId })
  if (!result.data) return

  const forkedSession = result.data

  // Insert new session into child store so sidebar updates immediately
  const current = store.getState()
  const sessions = [...current.session]
  const searchResult = Binary.search(sessions, forkedSession.id, (s) => s.id)
  if (!searchResult.found) {
    sessions.splice(searchResult.index, 0, forkedSession)
    store.setState({ session: sessions })
  }

  useSessionUIStore.getState().setCurrentSession(forkedSession.id)

  if (messageText) {
    useInputStore.setState({
      pendingInputText: messageText,
      pendingInputMode: "replace" as const,
    })
  }

  if (parts.length > 0) {
    const files = await extractAttachedFilesFromParts(parts)
    if (files.length > 0) {
      useInputStore.getState().setAttachedFiles(files)
    }
  }
}
