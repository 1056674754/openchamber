/**
 * Persisted child-store metadata caches.
 *
 * VCS info, project metadata, and icons are cached to localStorage
 * per serverId + directory so they survive page reloads and do not
 * collide across local/remote instances that share a path.
 * Only metadata is persisted — session/message/part data is always fresh
 * from the server via SSE bootstrap.
 */

import type { VcsInfo } from "@opencode-ai/sdk/v2/client"
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import type { ProjectMeta } from "./types"

// ---------------------------------------------------------------------------
// Storage key generation
// ---------------------------------------------------------------------------

function hashCode(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function legacyStoragePrefix(directory: string): string {
  const head = directory.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "_")
  return `oc.dir.${head}.${hashCode(directory)}`
}

function storagePrefix(serverId: string, directory: string): string {
  const scope = `${serverId}\0${directory}`
  const head = directory.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "_")
  return `oc.dir.v2.${head}.${hashCode(scope)}`
}

// ---------------------------------------------------------------------------
// Typed cache helpers
// ---------------------------------------------------------------------------

type CacheKey = "vcs" | "projectMeta" | "icon"

function cacheKey(serverId: string, directory: string, key: CacheKey): string {
  return `${storagePrefix(serverId, directory)}.${key}`
}

function legacyCacheKey(directory: string, key: CacheKey): string {
  return `${legacyStoragePrefix(directory)}.${key}`
}

function readCache<T>(serverId: string, directory: string, key: CacheKey): T | undefined {
  try {
    const v2Key = cacheKey(serverId, directory, key)
    const raw = localStorage.getItem(v2Key)
    if (raw) {
      return JSON.parse(raw) as T
    }

    // One-shot migrate from pre-serverId keys (default server only).
    if (serverId === DEFAULT_SERVER_ID) {
      const legacyKey = legacyCacheKey(directory, key)
      const legacyRaw = localStorage.getItem(legacyKey)
      if (!legacyRaw) return undefined
      localStorage.setItem(v2Key, legacyRaw)
      localStorage.removeItem(legacyKey)
      return JSON.parse(legacyRaw) as T
    }

    return undefined
  } catch {
    return undefined
  }
}

function writeCache<T>(serverId: string, directory: string, key: CacheKey, value: T | undefined): void {
  try {
    const k = cacheKey(serverId, directory, key)
    if (value === undefined) {
      localStorage.removeItem(k)
    } else {
      localStorage.setItem(k, JSON.stringify(value))
    }
  } catch {
    // localStorage quota exceeded — ignore
  }
}

function clearCache(serverId: string, directory: string): void {
  try {
    const prefix = storagePrefix(serverId, directory)
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type PersistedDirCache = {
  vcs: VcsInfo | undefined
  projectMeta: ProjectMeta | undefined
  icon: string | undefined
}

/** Read all cached metadata for a serverId + directory scope */
export function readDirCache(directory: string, serverId: string = DEFAULT_SERVER_ID): PersistedDirCache {
  return {
    vcs: readCache<VcsInfo>(serverId, directory, "vcs"),
    projectMeta: readCache<ProjectMeta>(serverId, directory, "projectMeta"),
    icon: readCache<string>(serverId, directory, "icon"),
  }
}

/** Write vcs info to cache */
export function persistVcs(directory: string, vcs: VcsInfo | undefined, serverId: string = DEFAULT_SERVER_ID): void {
  writeCache(serverId, directory, "vcs", vcs)
}

/** Write project metadata to cache */
export function persistProjectMeta(directory: string, meta: ProjectMeta | undefined, serverId: string = DEFAULT_SERVER_ID): void {
  writeCache(serverId, directory, "projectMeta", meta)
}

/** Write icon to cache */
export function persistIcon(directory: string, icon: string | undefined, serverId: string = DEFAULT_SERVER_ID): void {
  writeCache(serverId, directory, "icon", icon)
}

/** Clear cached metadata for one serverId + directory scope only */
export function clearDirCache(directory: string, serverId: string = DEFAULT_SERVER_ID): void {
  clearCache(serverId, directory)
}
