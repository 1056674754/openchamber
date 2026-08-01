import { create } from 'zustand';
import type { Session } from '@opencode-ai/sdk/v2';
import type { DesktopSettings } from '@/lib/desktop';
import { updateDesktopSettings } from '@/lib/persistence';
import {
  SESSION_PINNED_STORAGE_KEY,
  areStringSetsEqual,
  markHostSessionPinsApplied,
} from '@/lib/sessionPinSettings';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { getSafeStorage } from './utils/safeStorage';

export type PinnedSessionMeta = {
  id: string;
  title: string;
  directory?: string;
  serverId?: string;
  updatedAt: number;
  cachedAt: number;
};

const PINNED_META_STORAGE_KEY = 'oc.sessions.pinned.meta';
const META_MAX_ENTRIES = 200;

const readPinned = (storage: Storage): Set<string> => {
  try {
    const raw = storage.getItem(SESSION_PINNED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
};

const persistPinned = (storage: Storage, ids: Set<string>): void => {
  try {
    storage.setItem(SESSION_PINNED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore
  }
};

const readMeta = (storage: Storage): Map<string, PinnedSessionMeta> => {
  try {
    const raw = storage.getItem(PINNED_META_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    const map = new Map<string, PinnedSessionMeta>();
    for (const entry of parsed) {
      if (entry && typeof entry === 'object' && typeof (entry as PinnedSessionMeta).id === 'string') {
        map.set((entry as PinnedSessionMeta).id, entry as PinnedSessionMeta);
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

const persistMeta = (storage: Storage, meta: Map<string, PinnedSessionMeta>): void => {
  try {
    const filtered = [...meta.values()].filter((m) => readPinned(storage).has(m.id)).slice(0, META_MAX_ENTRIES);
    storage.setItem(PINNED_META_STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // ignore
  }
};

const pruneStaleMeta = (
  meta: Map<string, PinnedSessionMeta>,
  pinnedIds: Set<string>,
): Map<string, PinnedSessionMeta> => {
  if (meta.size === 0) return meta;
  let changed = false;
  const next = new Map(meta);
  for (const id of next.keys()) {
    if (!pinnedIds.has(id)) {
      next.delete(id);
      changed = true;
    }
  }
  return changed ? next : meta;
};

type SessionPinnedStore = {
  ids: Set<string>;
  metadataCache: Map<string, PinnedSessionMeta>;
  setIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  toggle: (sessionId: string) => void;
  replaceFromRemote: (ids: string[]) => void;
  rehydrate: () => void;
  upsertMetadata: (sessions: Session[]) => void;
};

const safeStorage = getSafeStorage();

/** When true, local mutations must not PUT back to host settings. */
let suppressHostSync = false;

const syncPinnedSessionsToHost = (ids: Set<string>): void => {
  if (suppressHostSync) return;
  void updateDesktopSettings({ pinnedSessions: [...ids] });
};

export const useSessionPinnedStore = create<SessionPinnedStore>((set, get) => ({
  ids: readPinned(safeStorage),
  metadataCache: readMeta(safeStorage),
  setIds: (next) => {
    const current = get().ids;
    const resolved = typeof next === 'function' ? next(current) : next;
    if (resolved === current) return;
    set({ ids: resolved });
    persistPinned(safeStorage, resolved);
    syncPinnedSessionsToHost(resolved);
  },
  toggle: (sessionId) => {
    const current = get().ids;
    const next = new Set(current);
    if (next.has(sessionId)) {
      next.delete(sessionId);
    } else {
      next.add(sessionId);
    }
    const meta = pruneStaleMeta(get().metadataCache, next);
    set({ ids: next, metadataCache: meta });
    persistPinned(safeStorage, next);
    persistMeta(safeStorage, meta);
    syncPinnedSessionsToHost(next);
  },
  replaceFromRemote: (ids) => {
    const next = new Set(ids.filter((item): item is string => typeof item === 'string' && item.length > 0));
    const current = get().ids;
    if (areStringSetsEqual(current, next)) {
      persistPinned(safeStorage, next);
      return;
    }
    suppressHostSync = true;
    try {
      const meta = pruneStaleMeta(get().metadataCache, next);
      set({ ids: next, metadataCache: meta });
      persistPinned(safeStorage, next);
      persistMeta(safeStorage, meta);
    } finally {
      suppressHostSync = false;
    }
  },
  rehydrate: () => {
    const next = readPinned(safeStorage);
    const current = get().ids;
    if (areStringSetsEqual(next, current)) return;
    suppressHostSync = true;
    try {
      set({ ids: next });
    } finally {
      suppressHostSync = false;
    }
  },
  upsertMetadata: (sessions) => {
    const pinnedIds = get().ids;
    if (pinnedIds.size === 0) return;
    let changed = false;
    const next = new Map(get().metadataCache);
    const now = Date.now();
    for (const session of sessions) {
      if (!session?.id || !pinnedIds.has(session.id)) continue;
      const existing = next.get(session.id);
      const title = session.title ?? existing?.title ?? '';
      const directory = (session as Session & { directory?: string }).directory ?? existing?.directory;
      if (existing && existing.title === title && existing.directory === directory) continue;
      next.set(session.id, {
        id: session.id,
        title,
        directory,
        serverId: serverRegistry.getServerForSession(session.id) ?? existing?.serverId,
        updatedAt: session.time?.updated ?? session.time?.created ?? existing?.updatedAt ?? 0,
        cachedAt: now,
      });
      changed = true;
    }
    if (changed) {
      set({ metadataCache: next });
      persistMeta(safeStorage, next);
    }
  },
}));

// `storage` event fires only in OTHER tabs, so same-tab toggle() stays authoritative.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_PINNED_STORAGE_KEY) return;
    useSessionPinnedStore.getState().rehydrate();
  });

  window.addEventListener('openchamber:settings-synced', (event: Event) => {
    const detail = (event as CustomEvent<DesktopSettings>).detail;
    if (!detail) return;

    if (Array.isArray(detail.pinnedSessions)) {
      useSessionPinnedStore.getState().replaceFromRemote(detail.pinnedSessions);
      markHostSessionPinsApplied();
      return;
    }

    // Host responded without global pins — handshake done; migrate local once.
    markHostSessionPinsApplied();
    const local = [...useSessionPinnedStore.getState().ids];
    if (local.length > 0) {
      void updateDesktopSettings({ pinnedSessions: local });
    }
  });
}
