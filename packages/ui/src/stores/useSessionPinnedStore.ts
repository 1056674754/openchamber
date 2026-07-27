import { create } from 'zustand';
import type { DesktopSettings } from '@/lib/desktop';
import { updateDesktopSettings } from '@/lib/persistence';
import {
  SESSION_PINNED_STORAGE_KEY,
  areStringSetsEqual,
  markHostSessionPinsApplied,
} from '@/lib/sessionPinSettings';
import { getSafeStorage } from './utils/safeStorage';

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

type SessionPinnedStore = {
  ids: Set<string>;
  setIds: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  toggle: (sessionId: string) => void;
  replaceFromRemote: (ids: string[]) => void;
  rehydrate: () => void;
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
    set({ ids: next });
    persistPinned(safeStorage, next);
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
      set({ ids: next });
      persistPinned(safeStorage, next);
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
