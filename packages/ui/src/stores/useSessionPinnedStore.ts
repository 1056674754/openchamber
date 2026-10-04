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
import { getSafeStorage, registerSafeStorageRehydrate } from './utils/safeStorage';

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
    const pinnedIds = readPinned(storage);
    const filtered = [...meta.values()].filter((m) => pinnedIds.has(m.id)).slice(0, META_MAX_ENTRIES);
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
  /**
   * Fetch metadata for pinned IDs the catalogs did not cover (cross-directory
   * pins on servers without a global session-list endpoint) via per-session
   * GETs, then feed them through upsertMetadata. No-op while another backfill
   * is in flight; failures are logged, not thrown — the catalog path remains
   * the primary source.
   */
  backfillMissingMetadata: (coveredSessions: readonly Session[]) => Promise<void>;
};

const safeStorage = getSafeStorage();

/** When true, local mutations must not PUT back to host settings. */
let suppressHostSync = false;

let backfillInFlight = false;
const BACKFILL_MAX_SESSIONS = 50;

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
    const meta = pruneStaleMeta(get().metadataCache, resolved);
    set({ ids: resolved, metadataCache: meta });
    persistPinned(safeStorage, resolved);
    persistMeta(safeStorage, meta);
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
      // A fresh client's in-memory cache is empty; writing it back would clobber
      // titles another client already persisted. Only persist non-empty meta here.
      if (meta.size > 0) {
        persistMeta(safeStorage, meta);
      }
    } finally {
      suppressHostSync = false;
    }
  },
  rehydrate: () => {
    const next = readPinned(safeStorage);
    const current = get().ids;
    // Merge host-file meta under anything this client already upserted — the
    // host snapshot can arrive after catalogs started filling the cache.
    const currentMeta = get().metadataCache;
    const storedMeta = readMeta(safeStorage);
    const storedContributes = [...storedMeta.keys()].some((id) => !currentMeta.has(id));
    if (areStringSetsEqual(next, current) && !storedContributes) return;
    suppressHostSync = true;
    try {
      if (storedContributes) {
        const merged = pruneStaleMeta(new Map([...storedMeta, ...currentMeta]), next);
        set({ ids: next, metadataCache: merged });
      } else {
        set({ ids: next });
      }
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
  backfillMissingMetadata: async (coveredSessions) => {
    const pinnedIds = get().ids;
    if (pinnedIds.size === 0 || backfillInFlight) return;
    const covered = new Set(coveredSessions.map((session) => session?.id).filter((id): id is string => Boolean(id)));
    const missing = [...pinnedIds].filter(
      (id) => !covered.has(id) && !get().metadataCache.get(id)?.title,
    );
    if (missing.length === 0) return;

    backfillInFlight = true;
    try {
      // Lazy import keeps the heavyweight opencode client module off this
      // store's import graph (and off every test that mocks safeStorage).
      const { opencodeClient } = await import('@/lib/opencode/client');
      const sdk = opencodeClient.getSdkClient();
      const results = await Promise.allSettled(
        missing.slice(0, BACKFILL_MAX_SESSIONS).map(async (id) => {
          const result = await sdk.session.get({ sessionID: id });
          return result.data ?? null;
        }),
      );
      const fetched: Session[] = [];
      let failed = 0;
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.id) {
          const session = result.value;
          // v2 wire keeps the directory at `location.directory`; upsertMetadata
          // reads the projected top-level `directory` field.
          const record = session as Session & {
            directory?: string | null;
            location?: { directory?: string | null } | null;
            project?: { worktree?: string | null } | null;
          };
          if (!record.directory && (record.location?.directory ?? record.project?.worktree)) {
            fetched.push({
              ...session,
              directory: record.location?.directory ?? record.project?.worktree ?? undefined,
            } as Session);
          } else {
            fetched.push(session);
          }
        } else if (result.status === 'rejected') {
          failed += 1;
        }
      }
      if (fetched.length > 0) {
        get().upsertMetadata(fetched);
      }
      if (failed > 0) {
        console.warn(`[SessionPinned] Metadata backfill failed for ${failed}/${missing.length} pinned session(s)`);
      }
    } finally {
      backfillInFlight = false;
    }
  },
}));

// `storage` event fires only in OTHER tabs, so same-tab toggle() stays authoritative.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_PINNED_STORAGE_KEY) return;
    useSessionPinnedStore.getState().rehydrate();
  });

  // Host settings can arrive after this store was created from an empty
  // in-memory map; re-read ids + meta once the host snapshot lands.
  registerSafeStorageRehydrate(() => {
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
