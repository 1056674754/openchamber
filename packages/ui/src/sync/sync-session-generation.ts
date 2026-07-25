/**
 * Per-session generation counter for sync loads.
 * Keyed by `serverId + directory + sessionID` (caller supplies the full key).
 * When a newer sync starts for the same key, older in-flight loads become stale
 * and must not write to the store.
 */
const syncSessionGenerationByKey = new Map<string, number>()

/** Bump generation for `key` and return `isStale()`. */
export function beginSyncSessionGeneration(key: string): () => boolean {
  const generation = (syncSessionGenerationByKey.get(key) ?? 0) + 1
  syncSessionGenerationByKey.set(key, generation)
  return () => syncSessionGenerationByKey.get(key) !== generation
}

export function resetSyncSessionGenerationsForTests(): void {
  syncSessionGenerationByKey.clear()
}
