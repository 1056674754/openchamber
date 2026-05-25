/**
 * Session actions — SDK-calling operations for session management.
 * Replaces the action methods from the old useSessionStore.
 */

import type { OpencodeClient, Session, Message, Part } from "@opencode-ai/sdk/v2/client"
import { Binary } from "./binary"
import { useSessionUIStore } from "./session-ui-store"
import { useInputStore } from "./input-store"
import type { ChildStoreManager } from "./child-store"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { registerSessionDirectory } from "./sync-refs"
import { isSyntheticPart } from "@/lib/messages/synthetic"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { registerRemoteInstanceProxy } from "@/lib/remote-instances/registry"
import { getSyncStoresForServer, getAllSyncStores } from "./multi-server-registry"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { getWorktreesForProject } from "@/lib/worktrees/worktreeKeys"
import { materializeSessionSnapshots } from "./materialization"
import { stripMessageDiffSnapshots } from "./sanitize"
import { sessionEvents } from "@/lib/sessionEvents"

const MESSAGE_REFETCH_LIMIT = 200
const MESSAGE_REFETCH_SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const UNREVERT_REFETCH_ATTEMPTS = 3
const UNREVERT_REFETCH_RETRY_MS = 150

// Reference set by SyncProvider — allows actions to access SDK and stores
let _sdk: OpencodeClient | null = null
let _childStores: ChildStoreManager | null = null
let _getDirectory: () => string = () => ""
let _optimisticAdd: ((input: { sessionID: string; message: Message; parts: Part[] }) => void) | null = null
let _optimisticRemove: ((input: { sessionID: string; messageID: string }) => void) | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

const normalizeDirectoryKey = (directory: string): string =>
  directory.replace(/\\/g, "/").replace(/\/+$/, "") || "/"

function usesDefaultConnection(project: { serverId?: string | null }): boolean {
  return !project.serverId || project.serverId === DEFAULT_SERVER_ID
}

function shouldPreferProjectMatch<T extends { serverId?: string | null }>(
  candidate: T,
  candidateLength: number,
  current: T | null,
  currentLength: number,
): boolean {
  if (!current) return true
  if (candidateLength !== currentLength) return candidateLength > currentLength
  return usesDefaultConnection(candidate) && !usesDefaultConnection(current)
}

function findProjectForDirectory(directory: string) {
  const normalizedDir = normalizeDirectoryKey(directory)
  const projects = useProjectsStore.getState().projects
  const worktreesByProject = useSessionUIStore.getState().availableWorktreesByProject

  let bestWorktreeOwner: { project: typeof projects[number]; matchLength: number } | null = null
  for (const project of projects) {
    const projectPath = normalizeDirectoryKey(project.path)
    const worktrees = getWorktreesForProject(worktreesByProject, projectPath, project.serverId)
    for (const wt of worktrees) {
      if (wt.serverId && wt.serverId !== project.serverId) continue
      const worktreePath = normalizeDirectoryKey(wt.path)
      if (!worktreePath || (normalizedDir !== worktreePath && !normalizedDir.startsWith(`${worktreePath}/`))) {
        continue
      }
      if (shouldPreferProjectMatch(project, worktreePath.length, bestWorktreeOwner?.project ?? null, bestWorktreeOwner?.matchLength ?? -1)) {
        bestWorktreeOwner = { project, matchLength: worktreePath.length }
      }
    }
  }
  if (bestWorktreeOwner) return bestWorktreeOwner.project

  let best: typeof projects[number] | null = null
  for (const project of projects) {
    const projectPath = normalizeDirectoryKey(project.path)
    if (normalizedDir !== projectPath && !normalizedDir.startsWith(`${projectPath}/`)) continue
    if (shouldPreferProjectMatch(project, projectPath.length, best, best ? normalizeDirectoryKey(best.path).length : -1)) {
      best = project
    }
  }
  return best
}

function getOrRegisterRemoteConnection(serverId: string, label?: string) {
  const existing = serverRegistry.get(serverId)
  if (existing) {
    if (existing.healthStatus !== "healthy") {
      void serverRegistry.probeHealth(serverId)
    }
    return existing
  }
  const connection = registerRemoteInstanceProxy({
    id: serverId,
    label: label?.trim() || serverId,
    healthStatus: "connecting",
  })
  void serverRegistry.probeHealth(serverId)
  return connection
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

// [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
// Module-level cache: directory → serverId. Populated by discoverWorktreeDirectories
// before the deferred ensureRemoteProject. Avoids the timing gap where
// resolveSdkForDirectory is called before the project is registered.
const _directoryServerCache = new Map<string, string>();

export function setDirectoryServerId(directory: string, serverId: string): void {
  _directoryServerCache.set(normalizeDirectoryKey(directory), serverId);
}

function getCachedServerIdForDirectory(directory: string): string | null {
  let best: { serverId: string; length: number } | null = null;
  for (const [cachedDirectory, serverId] of _directoryServerCache) {
    if (directory !== cachedDirectory && !directory.startsWith(`${cachedDirectory}/`)) {
      continue;
    }
    if (!best || cachedDirectory.length > best.length) {
      best = { serverId, length: cachedDirectory.length };
    }
  }
  return best?.serverId ?? null;
}

/** Resolve the correct SDK client for a directory by looking up its project's serverId.
 *  When sessionID or explicitServerId is provided, uses the authoritative serverRegistry session index. */
export function resolveSdkForDirectory(directory: string, sessionID?: string, explicitServerId?: string): OpencodeClient {
  const normalizedDir = normalizeDirectoryKey(directory)

  // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
  // Authoritative source: explicitServerId overrides everything.
  if (explicitServerId && explicitServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(explicitServerId).client
  }
  if (explicitServerId === DEFAULT_SERVER_ID) {
    const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
    if (defaultConn) return defaultConn.client
    return sdk()
  }

  // Authoritative source: serverRegistry session index. No path matching.
  if (sessionID) {
    const sessionServerId = serverRegistry.getServerForSession(sessionID)
    if (sessionServerId && sessionServerId !== DEFAULT_SERVER_ID) {
      return getOrRegisterRemoteConnection(sessionServerId).client
    }
    // Session is known but has no server mapping (local). Fall through to directory-based lookup only for local.
    if (sessionServerId === DEFAULT_SERVER_ID) {
      const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
      if (defaultConn) return defaultConn.client
      return sdk()
    }
  }

  // Project ownership is stronger than stale remote child stores/cache. If a
  // user has explicitly added a project on the default connection slot, do not
  // let an old remote store for the same path hijack new turns.
  const project = findProjectForDirectory(normalizedDir)
  if (project?.serverId && project.serverId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(project.serverId, project.label).client
  }
  if (project) {
    const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
    if (defaultConn) return defaultConn.client
    return sdk()
  }

  const cachedServerId = getCachedServerIdForDirectory(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(cachedServerId).client
  }

  // Check if any remote SyncProvider already has a child store for this directory
  const allEntries = getAllSyncStores()
  for (const e of allEntries) {
    if (e.serverId === DEFAULT_SERVER_ID) continue
    if (e.childStores.children.has(normalizedDir)) {
      return getOrRegisterRemoteConnection(e.serverId).client
    }
  }

  const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConn) return defaultConn.client
  return sdk()
}

/** Resolve the base URL (including /api suffix) for a directory's remote server.
 *  Returns undefined if the directory belongs to the default connection slot. */
export function resolveBaseUrl(directory: string): string | undefined {
  const normalizedDir = normalizeDirectoryKey(directory)

  // Tier 1: explicit project ownership.
  const project = findProjectForDirectory(normalizedDir)
  if (project) {
    if (!project.serverId || project.serverId === DEFAULT_SERVER_ID) return undefined
    return getOrRegisterRemoteConnection(project.serverId, project.label).config.baseUrl
  }

  // Tier 2: directory→server cache (populated by discoverWorktreeDirectories)
  const cachedServerId = _directoryServerCache.get(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(cachedServerId).config.baseUrl
  }

  return undefined
}

export function resolveBaseUrlForSession(sessionId: string | null | undefined, directory?: string | null, explicitServerId?: string): string | undefined {
  if (explicitServerId && explicitServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(explicitServerId).config.baseUrl
  }
  if (explicitServerId === DEFAULT_SERVER_ID) return undefined

  if (sessionId) {
    const serverId = serverRegistry.getServerForSession(sessionId)
    if (serverId) {
      if (serverId === DEFAULT_SERVER_ID) return undefined
      return getOrRegisterRemoteConnection(serverId).config.baseUrl
    }
  }
  return directory ? resolveBaseUrl(directory) : undefined
}

function getServerIdForBaseUrl(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null
  const normalized = baseUrl.replace(/\/+$/, "")
  const connection = serverRegistry.getAll().find((entry) => entry.config.baseUrl.replace(/\/+$/, "") === normalized)
  return connection?.config.id ?? null
}

/** Resolve the registered server base URL for a directory. */
export function resolveApiUrl(directory: string): string | undefined {
  const normalizedDir = normalizeDirectoryKey(directory)

  // Tier 1: explicit project ownership.
  const project = findProjectForDirectory(normalizedDir)
  if (project) {
    if (!project.serverId || project.serverId === DEFAULT_SERVER_ID) return undefined
    return getOrRegisterRemoteConnection(project.serverId, project.label).config.baseUrl
  }

  // Tier 2: directory→server cache (populated by discoverWorktreeDirectories)
  const cachedServerId = _directoryServerCache.get(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(cachedServerId).config.baseUrl
  }

  return undefined
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

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function createSession(
  title?: string,
  directoryOverride?: string | null,
  parentID?: string | null,
  serverId?: string | null,
): Promise<Session | null> {
  try {
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
    })
    const session = result.data
    if (!session) return null

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

      useSessionUIStore.getState().setCurrentSession(
        session.id,
        sessionDirectory,
        resolvedServerId ? { serverId: resolvedServerId } : undefined,
      )
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
  console.info("[session-actions] abort: start", { sessionId })

  const liveDirectory = _getDirectory() || undefined
  let sessionDirectory: string | undefined
  let sessionDirectoryError: string | undefined
  try {
    sessionDirectory = requireSessionDirectory(sessionId, "abortCurrentOperation")
  } catch (err) {
    sessionDirectoryError = String(err)
  }

  const directories = new Set<string>()
  if (liveDirectory) directories.add(liveDirectory)
  if (sessionDirectory) directories.add(sessionDirectory)

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
    useGlobalSessionsStore.getState().upsertStatus(sessionId, { type: "idle" })
    return
  }

  const client = sdkForSession(sessionId)

  const t0 = Date.now()
  const results: Array<{ directory: string; ok: boolean; error?: string; ms: number }> = []
  const abortPromises = [...directories].map(async (dir) => {
    const callStart = Date.now()
    try {
      await client.session.abort({ sessionID: sessionId, directory: dir })
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

  console.info("[session-actions] abort: done", {
    sessionId,
    totalMs: elapsed,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    directories: results.map(r => r.directory),
  })

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

function restoreFilePartsToInput(fileParts: Array<Record<string, unknown>>): void {
  useInputStore.getState().clearAttachedFiles()
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

  restoreFilePartsToInput(submittedFileParts)

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
      attachedFiles: prevInputAttachments,
    })
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
  const records = (result.data ?? []).filter((record: { info?: { id?: string } }) => !!record?.info?.id)
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
  if (result.data) {
    const current = store.getState()
    const sessions = [...current.session]
    const idx = sessions.findIndex((s) => s.id === sessionId)
    if (idx >= 0) {
      sessions[idx] = result.data
      store.setState({ session: sessions })
    }
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
export async function forkFromMessage(sessionId: string, messageId: string): Promise<void> {
  const sessionDirectory = requireSessionDirectory(sessionId, "forkFromMessage")
  const store = storeForSession(sessionId)
  const state = store.getState()

  const parts = state.part[messageId] ?? []
  const messageText = extractUserMessageText(parts)
  const fileParts = parts.filter((p) => p.type === "file" && !isSyntheticPart(p)) as Array<Record<string, unknown>>

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

  restoreFilePartsToInput(fileParts)
}
