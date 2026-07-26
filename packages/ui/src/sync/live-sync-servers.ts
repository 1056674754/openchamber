import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"

export type LiveSyncServer = {
  id: string
  sdk: OpencodeClient
  baseUrl: string
}

/**
 * Instances list may show many remotes; live SyncProvider fanout is only for
 * the UI-bound active remote (session/project). List loading must not mount N sync engines.
 */
export function resolveLiveSyncServers(activeServerId: string | null | undefined): LiveSyncServer[] {
  const serverId = activeServerId?.trim() || DEFAULT_SERVER_ID
  if (!serverId || serverId === DEFAULT_SERVER_ID) return []

  const connection = serverRegistry.get(serverId)
  if (!connection || connection.healthStatus !== "healthy") return []

  return [{
    id: connection.config.id,
    sdk: connection.client,
    baseUrl: connection.config.sseUrl || connection.config.baseUrl,
  }]
}

export function areLiveSyncServerListsEquivalent(
  left: LiveSyncServer[],
  right: LiveSyncServer[],
): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (
      left[i]?.id !== right[i]?.id
      || left[i]?.sdk !== right[i]?.sdk
      || left[i]?.baseUrl !== right[i]?.baseUrl
    ) {
      return false
    }
  }
  return true
}
