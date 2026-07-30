export type SyncMeta = {
  limit: number
  cursor: string | undefined
  complete: boolean
  loading: boolean
}

export function preserveCompleteHistoryCoverage(
  previous: { cursor?: string; complete: boolean },
  next: { cursor?: string; complete: boolean },
): { cursor: string | undefined; complete: boolean } {
  if (!previous.complete) {
    return {
      cursor: next.cursor,
      complete: next.complete,
    }
  }
  return {
    cursor: previous.cursor,
    complete: true,
  }
}

export function reconcileSyncMeta(
  local: SyncMeta | undefined,
  prefetch: SyncMeta | undefined,
): SyncMeta | undefined {
  if (!local) return prefetch
  if (!prefetch || prefetch.limit < local.limit) return local

  return {
    ...prefetch,
    ...preserveCompleteHistoryCoverage(local, prefetch),
    loading: local.loading,
  }
}
