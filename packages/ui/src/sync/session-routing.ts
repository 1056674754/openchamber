import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ProjectEntry } from "@/lib/api/types"
import type { WorktreeMetadata } from "@/types/worktree"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { registerRemoteInstanceProxy } from "@/lib/remote-instances/registry"
import { getWorktreesForProject } from "@/lib/worktrees/worktreeKeys"
import { normalizePath } from "@/lib/pathNormalization"
import { getAllSyncStores } from "./multi-server-registry"
import { UnresolvedSessionServerError } from "./session-authority"

type RoutingContextGetters = {
  getProjects: () => readonly ProjectEntry[]
  getAvailableWorktreesByProject: () => Map<string, WorktreeMetadata[]>
}

let routingContextGetters: RoutingContextGetters = {
  getProjects: () => [],
  getAvailableWorktreesByProject: () => new Map(),
}

export function setSessionRoutingContextGetters(getters: RoutingContextGetters): void {
  routingContextGetters = getters
}

export const normalizeDirectoryKey = (directory: string): string =>
  normalizePath(directory) ?? "/"

export function requireExistingSessionDirectory(
  sessionID: string,
  directory: string | null | undefined,
): string {
  const normalizedDirectory = normalizePath(directory)
  if (!normalizedDirectory) {
    throw new Error(`Directory for session ${sessionID} is not available`)
  }
  return normalizedDirectory
}

/** Prefer the longer project-path match. Equal-length matches keep the current
 *  candidate: never prefer the default/local connection on a tie, because two
 *  servers can expose identical paths and local-preference would silently
 *  reroute remote sessions to the local filesystem. */
function shouldPreferProjectMatch<T extends { serverId?: string | null }>(
  candidate: T,
  candidateLength: number,
  current: T | null,
  currentLength: number,
): boolean {
  if (!current) return true
  return candidateLength > currentLength
}

function findProjectForDirectory(directory: string): ProjectEntry | null {
  const normalizedDir = normalizeDirectoryKey(directory)
  const projects = routingContextGetters.getProjects()
  const worktreesByProject = routingContextGetters.getAvailableWorktreesByProject()

  let bestWorktreeOwner: { project: ProjectEntry; matchLength: number } | null = null
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

  let best: ProjectEntry | null = null
  for (const project of projects) {
    const projectPath = normalizeDirectoryKey(project.path)
    if (normalizedDir !== projectPath && !normalizedDir.startsWith(`${projectPath}/`)) continue
    if (shouldPreferProjectMatch(project, projectPath.length, best, best ? normalizeDirectoryKey(best.path).length : -1)) {
      best = project
    }
  }
  return best
}

export function getOrRegisterRemoteConnection(serverId: string, label?: string) {
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

/** Directory → owning servers. A directory may legitimately belong to multiple
 *  servers (identical paths across remote instances); queries must treat
 *  multi-owner directories as ambiguous instead of picking one. */
const _directoryServerCache = new Map<string, Set<string>>()

export function setDirectoryServerId(directory: string, serverId: string): void {
  const key = normalizeDirectoryKey(directory)
  const existing = _directoryServerCache.get(key)
  if (existing) {
    existing.add(serverId)
  } else {
    _directoryServerCache.set(key, new Set([serverId]))
  }
}

/** Best single owner for a directory, or null when ambiguous/unresolved.
 *  Prefix matches return the longest owned prefix; a prefix owned by multiple
 *  servers yields null so callers fail closed rather than guess. */
function getCachedServerIdForDirectory(directory: string): string | null {
  let best: { serverId: string; length: number } | null = null
  for (const [cachedDirectory, serverIds] of _directoryServerCache) {
    if (directory !== cachedDirectory && !directory.startsWith(`${cachedDirectory}/`)) {
      continue
    }
    if (!best || cachedDirectory.length > best.length) {
      if (serverIds.size === 1) {
        best = { serverId: serverIds.values().next().value as string, length: cachedDirectory.length }
      } else {
        best = { serverId: "", length: cachedDirectory.length }
      }
    }
  }
  return best && best.serverId ? best.serverId : null
}

function defaultSdkClient(fallbackClient?: OpencodeClient | null): OpencodeClient {
  const defaultConn = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConn) return defaultConn.client
  if (fallbackClient) return fallbackClient
  throw new Error("Default OpenCode SDK client is not registered")
}

/** Resolved routing target: the owning server instance and its v1 SDK client.
 *  `resolveSdkForDirectory` is a thin wrapper over this so callers that also
 *  need the serverId (the OC2 dual-track protocol handle keys the protocol
 *  mode and the provider circuit on it) resolve through the exact same
 *  decision path — there is deliberately no second routing implementation. */
export type ResolvedSdkRoute = {
  serverId: string
  client: OpencodeClient
}

/** Resolve the correct SDK client and its owning server for a request.
 *
 *  IMPORTANT: sessionID is authoritative when present. Do not prefer directory
 *  over the session-server index: multiple remote instances can legitimately
 *  expose identical paths such as /root or /Users/user. If a sessionID resolves
 *  to the wrong server, fix the code that wrote serverRegistry.indexSession();
 *  do not paper over it by routing from directory first.
 */
export function resolveSdkForDirectory(
  directory: string,
  sessionID?: string,
  explicitServerId?: string,
  fallbackClient?: OpencodeClient | null,
): OpencodeClient {
  return resolveRouteForDirectory(directory, sessionID, explicitServerId, fallbackClient).client
}

export function resolveRouteForDirectory(
  directory: string,
  sessionID?: string,
  explicitServerId?: string,
  fallbackClient?: OpencodeClient | null,
): ResolvedSdkRoute {
  const normalizedDir = normalizeDirectoryKey(directory)

  if (explicitServerId && explicitServerId !== DEFAULT_SERVER_ID) {
    return { serverId: explicitServerId, client: getOrRegisterRemoteConnection(explicitServerId).client }
  }
  if (explicitServerId === DEFAULT_SERVER_ID) {
    return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
  }

  // Authoritative source: serverRegistry session index. No path matching.
  if (sessionID) {
    const sessionServerId = serverRegistry.getServerForSession(sessionID)
    if (sessionServerId && sessionServerId !== DEFAULT_SERVER_ID) {
      return { serverId: sessionServerId, client: getOrRegisterRemoteConnection(sessionServerId).client }
    }
    if (sessionServerId === DEFAULT_SERVER_ID) {
      return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
    }
    // No authoritative server index for this session yet. The directory is an
    // explicit request context, so its ownership resolves the server: project
    // ownership, then directory-server cache, then a mounted remote child
    // store. Sessions without a directory ownership context route to local
    // through the default store below — fail-closed enforcement for
    // session-scoped mutations lives in storesForSession/sdkForSession, which
    // require an indexed server.
    const project = findProjectForDirectory(normalizedDir)
    if (project?.serverId && project.serverId !== DEFAULT_SERVER_ID) {
      return { serverId: project.serverId, client: getOrRegisterRemoteConnection(project.serverId, project.label).client }
    }
    if (project) {
      return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
    }
    const cachedServerId = getCachedServerIdForDirectory(normalizedDir)
    if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
      return { serverId: cachedServerId, client: getOrRegisterRemoteConnection(cachedServerId).client }
    }
    const allEntries = getAllSyncStores()
    for (const e of allEntries) {
      if (e.serverId === DEFAULT_SERVER_ID) continue
      if (e.childStores.children.has(normalizedDir)) {
        return { serverId: e.serverId, client: getOrRegisterRemoteConnection(e.serverId).client }
      }
    }
    return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
  }

  // Project ownership is stronger than stale remote child stores/cache. If a
  // user has explicitly added a project on the default connection slot, do not
  // let an old remote store for the same path hijack new turns.
  const project = findProjectForDirectory(normalizedDir)
  if (project?.serverId && project.serverId !== DEFAULT_SERVER_ID) {
    return { serverId: project.serverId, client: getOrRegisterRemoteConnection(project.serverId, project.label).client }
  }
  if (project) {
    return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
  }

  const cachedServerId = getCachedServerIdForDirectory(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return { serverId: cachedServerId, client: getOrRegisterRemoteConnection(cachedServerId).client }
  }

  // Check if any remote SyncProvider already has a child store for this directory.
  const allEntries = getAllSyncStores()
  for (const e of allEntries) {
    if (e.serverId === DEFAULT_SERVER_ID) continue
    if (e.childStores.children.has(normalizedDir)) {
      return { serverId: e.serverId, client: getOrRegisterRemoteConnection(e.serverId).client }
    }
  }

  return { serverId: DEFAULT_SERVER_ID, client: defaultSdkClient(fallbackClient) }
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

  // Tier 2: directory-server cache populated during remote project discovery.
  const cachedServerId = getCachedServerIdForDirectory(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(cachedServerId).config.baseUrl
  }

  return undefined
}

export function resolveBaseUrlForSession(
  sessionId: string | null | undefined,
  directory?: string | null,
  explicitServerId?: string,
): string | undefined {
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
    // Session-scoped with no authoritative server index. Directory-based
    // routing is only acceptable as a scoped fallback when the directory
    // itself has explicit project ownership; otherwise fail closed instead of
    // collapsing identical remote paths to the local server.
    if (directory) {
      const project = findProjectForDirectory(normalizeDirectoryKey(directory))
      if (project?.serverId && project.serverId !== DEFAULT_SERVER_ID) {
        return getOrRegisterRemoteConnection(project.serverId, project.label).config.baseUrl
      }
      if (project) return undefined
    }
    throw new UnresolvedSessionServerError(sessionId)
  }
  return directory ? resolveBaseUrl(directory) : undefined
}

export function getServerIdForBaseUrl(baseUrl: string | undefined): string | null {
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

  // Tier 2: directory-server cache populated during remote project discovery.
  const cachedServerId = getCachedServerIdForDirectory(normalizedDir)
  if (cachedServerId && cachedServerId !== DEFAULT_SERVER_ID) {
    return getOrRegisterRemoteConnection(cachedServerId).config.baseUrl
  }

  return undefined
}

/** Resolve serverId from project ownership for a directory.
 *  Returns null when no project owns the directory so callers can fall back
 *  to session/cache resolution. For directory activation, project ownership
 *  is authoritative — a stale session from another instance must not override it. */
export function resolveProjectServerIdForDirectory(directory: string): string | null {
  const normalizedDir = normalizeDirectoryKey(directory)
  const project = findProjectForDirectory(normalizedDir)
  if (!project) return null
  return project.serverId && project.serverId !== DEFAULT_SERVER_ID
    ? project.serverId
    : DEFAULT_SERVER_ID
}
