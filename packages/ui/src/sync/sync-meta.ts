export type SyncMeta = {
  limit: number
  cursor: string | undefined
  complete: boolean
  loading: boolean
}

export function reconcileSyncMeta(
  local: SyncMeta | undefined,
  prefetch: SyncMeta | undefined,
): SyncMeta | undefined {
  if (!local) return prefetch
  if (!prefetch || prefetch.limit < local.limit) return local

  return {
    ...prefetch,
    loading: local.loading,
  }
}
