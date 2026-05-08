import type { ChildStoreManager } from "./child-store";

type SyncStoreEntry = {
  serverId: string;
  childStores: ChildStoreManager;
  dispose: () => void;
};

const entries = new Map<string, SyncStoreEntry>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function registerSyncStores(
  serverId: string,
  childStores: ChildStoreManager,
  dispose: () => void,
): () => void {
  const existing = entries.get(serverId);
  if (existing) {
    existing.dispose();
  }
  entries.set(serverId, { serverId, childStores, dispose });
  notify();
  return () => {
    const entry = entries.get(serverId);
    if (entry && entry.childStores === childStores) {
      entry.dispose();
      entries.delete(serverId);
      notify();
    }
  };
}

export function getAllSyncStores(): ReadonlyArray<{
  serverId: string;
  childStores: ChildStoreManager;
}> {
  return Array.from(entries.values());
}

export function getSyncStoresForServer(
  serverId: string,
): ChildStoreManager | undefined {
  return entries.get(serverId)?.childStores;
}

export function subscribeSyncStoresRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
