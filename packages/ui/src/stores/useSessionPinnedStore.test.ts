import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  haveHostSessionPinsApplied,
  resetHostSessionPinsApplied,
} from '@/lib/sessionPinSettings';

const STORAGE_KEY = 'oc.sessions.pinned';
const memoryStore = new Map<string, string>();

const mockStorage = {
  getItem: (key: string) => memoryStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memoryStore.set(key, value);
  },
  removeItem: (key: string) => {
    memoryStore.delete(key);
  },
  clear: () => {
    memoryStore.clear();
  },
  get length() {
    return memoryStore.size;
  },
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
} as Storage;

mock.module('@/stores/utils/safeStorage', () => ({
  getSafeStorage: () => mockStorage,
  getSafeSessionStorage: () => mockStorage,
  getDeferredSafeStorage: () => mockStorage,
  registerSafeStorageRehydrate: () => () => undefined,
  // Pass-through stubs so modules imported by other test files in the same
  // process keep finding these named exports on the mocked module.
  hydrateLocalStore: () => undefined,
  flushSafeStorage: async () => undefined,
  createDeferredSafeJSONStorage: () => undefined,
}));

const updateDesktopSettingsCalls: Array<Record<string, unknown>> = [];
mock.module('@/lib/persistence', () => ({
  updateDesktopSettings: async (changes: Record<string, unknown>) => {
    updateDesktopSettingsCalls.push(changes);
  },
}));

const { useSessionPinnedStore } = await import('./useSessionPinnedStore');

const resetStore = () => {
  useSessionPinnedStore.setState({ ids: new Set<string>() });
};

describe('useSessionPinnedStore', () => {
  beforeEach(() => {
    memoryStore.clear();
    updateDesktopSettingsCalls.length = 0;
    resetHostSessionPinsApplied();
    resetStore();
  });

  describe('toggle', () => {
    test('adds a session ID when not present', () => {
      useSessionPinnedStore.getState().toggle('sess-1');
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['sess-1']));
    });

    test('removes a session ID when already present', () => {
      useSessionPinnedStore.getState().toggle('sess-1');
      useSessionPinnedStore.getState().toggle('sess-1');
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set());
    });

    test('persists to storage on add', () => {
      useSessionPinnedStore.getState().toggle('sess-1');
      expect(mockStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['sess-1']));
    });

    test('persists to storage on remove', () => {
      useSessionPinnedStore.getState().toggle('sess-1');
      useSessionPinnedStore.getState().toggle('sess-2');
      useSessionPinnedStore.getState().toggle('sess-1');
      expect(mockStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['sess-2']));
    });
  });

  describe('setIds', () => {
    test('accepts a Set directly', () => {
      useSessionPinnedStore.getState().setIds(new Set(['a', 'b']));
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['a', 'b']));
      expect(mockStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['a', 'b']));
    });

    test('accepts a updater function', () => {
      useSessionPinnedStore.getState().setIds(new Set(['a']));
      useSessionPinnedStore.getState().setIds((prev) => {
        const next = new Set(prev);
        next.add('b');
        return next;
      });
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['a', 'b']));
    });

    test('skips persist when updater returns the same reference', () => {
      const ids = new Set(['a']);
      useSessionPinnedStore.getState().setIds(ids);
      memoryStore.clear();
      useSessionPinnedStore.getState().setIds(ids);
      expect(mockStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('rehydrate', () => {
    test('reads from storage and updates state', () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['x', 'y']));
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['x', 'y']));
    });

    test('does not replace the Set reference when data is unchanged', () => {
      useSessionPinnedStore.getState().setIds(new Set(['a', 'b']));
      const idsBefore = useSessionPinnedStore.getState().ids;
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toBe(idsBefore);
    });

    test('rehydrate from empty storage yields empty set', () => {
      useSessionPinnedStore.setState({ ids: new Set(['orphaned']) });
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set());
    });

    test('handles corrupt JSON gracefully', () => {
      memoryStore.set(STORAGE_KEY, 'not-valid-json');
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set());
    });

    test('handles non-array JSON gracefully', () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify({ not: 'array' }));
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set());
    });

    test('filters non-string entries from storage', () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['valid', 123, null, 'also-valid']));
      useSessionPinnedStore.getState().rehydrate();
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['valid', 'also-valid']));
    });
  });

  describe('cross-tab storage event', () => {
    test('rehydrates when another tab writes the pinned key', () => {
      if (typeof window === 'undefined') return;

      memoryStore.set(STORAGE_KEY, JSON.stringify(['from-other-tab']));

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: STORAGE_KEY,
        }),
      );

      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['from-other-tab']));
    });

    test('ignores storage events for other keys', () => {
      if (typeof window === 'undefined') return;

      useSessionPinnedStore.getState().setIds(new Set(['original']));
      memoryStore.set(STORAGE_KEY, JSON.stringify(['should-not-apply']));

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'some-other-key',
        }),
      );

      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['original']));
    });
  });

  describe('host settings sync', () => {
    test('toggle pushes pinnedSessions to host settings', () => {
      useSessionPinnedStore.getState().toggle('sess-1');
      expect(updateDesktopSettingsCalls.some(
        (call) => JSON.stringify(call) === JSON.stringify({ pinnedSessions: ['sess-1'] }),
      )).toBe(true);
    });

    test('replaceFromRemote updates ids without pushing to host', () => {
      useSessionPinnedStore.getState().replaceFromRemote(['remote-a', 'remote-b']);
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['remote-a', 'remote-b']));
      expect(updateDesktopSettingsCalls).toEqual([]);
    });

    test('settings-synced with pinnedSessions applies remotely', () => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent('openchamber:settings-synced', {
          detail: { pinnedSessions: ['host-1'] },
        }),
      );
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['host-1']));
      expect(updateDesktopSettingsCalls).toEqual([]);
      expect(haveHostSessionPinsApplied()).toBe(true);
    });

    test('settings-synced without pinnedSessions migrates local pins', () => {
      if (typeof window === 'undefined') return;
      useSessionPinnedStore.getState().replaceFromRemote(['local-1']);
      updateDesktopSettingsCalls.length = 0;
      window.dispatchEvent(
        new CustomEvent('openchamber:settings-synced', {
          detail: { themeId: 'x' },
        }),
      );
      expect(haveHostSessionPinsApplied()).toBe(true);
      expect(updateDesktopSettingsCalls.some(
        (call) => JSON.stringify(call) === JSON.stringify({ pinnedSessions: ['local-1'] }),
      )).toBe(true);
    });

    test('settings-synced marks host pins applied even when empty', () => {
      if (typeof window === 'undefined') return;
      expect(haveHostSessionPinsApplied()).toBe(false);
      window.dispatchEvent(
        new CustomEvent('openchamber:settings-synced', {
          detail: { pinnedSessions: [] },
        }),
      );
      expect(haveHostSessionPinsApplied()).toBe(true);
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set());
    });
  });

  describe('metadata cache persistence', () => {
    const META_KEY = 'oc.sessions.pinned.meta';

    test('replaceFromRemote with an empty in-memory cache does not clobber persisted meta', () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['sess-1']));
      memoryStore.set(META_KEY, JSON.stringify([
        { id: 'sess-1', title: 'Cached title', updatedAt: 1, cachedAt: 1 },
      ]));
      // Fresh client boot: store cache still empty when host pins arrive.
      useSessionPinnedStore.setState({ ids: new Set(), metadataCache: new Map() });

      useSessionPinnedStore.getState().replaceFromRemote(['sess-1']);

      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['sess-1']));
      expect(memoryStore.get(META_KEY)).toBe(JSON.stringify([
        { id: 'sess-1', title: 'Cached title', updatedAt: 1, cachedAt: 1 },
      ]));
    });

    test('rehydrate merges host-file meta under in-memory entries', () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['a', 'b']));
      memoryStore.set(META_KEY, JSON.stringify([
        { id: 'b', title: 'Host B', updatedAt: 2, cachedAt: 1 },
      ]));
      useSessionPinnedStore.setState({
        ids: new Set(['a']),
        metadataCache: new Map([
          ['a', { id: 'a', title: 'Memory A', updatedAt: 9, cachedAt: 9 }],
        ]),
      });

      useSessionPinnedStore.getState().rehydrate();

      const meta = useSessionPinnedStore.getState().metadataCache;
      expect(meta.get('a')?.title).toBe('Memory A');
      expect(meta.get('b')?.title).toBe('Host B');
      expect(useSessionPinnedStore.getState().ids).toEqual(new Set(['a', 'b']));
    });
  });

  describe('backfillMissingMetadata', () => {
    const META_KEY = 'oc.sessions.pinned.meta';
    const fetchedSessions: Array<Record<string, unknown>> = [];
    let getSessionCalls: string[] = [];

    mock.module('@/lib/opencode/client', () => ({
      opencodeClient: {
        getSdkClient: () => ({
          session: {
            get: async ({ sessionID }: { sessionID: string }) => {
              getSessionCalls.push(sessionID);
              const match = fetchedSessions.find((s) => s.id === sessionID);
              return match ? { data: match } : { data: undefined };
            },
          },
        }),
      },
    }));

    beforeEach(() => {
      getSessionCalls = [];
      fetchedSessions.length = 0;
    });

    test('fetches uncovered pinned sessions and persists their titles', async () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['pin-1', 'pin-2']));
      useSessionPinnedStore.setState({
        ids: new Set(['pin-1', 'pin-2']),
        metadataCache: new Map(),
      });
      fetchedSessions.push(
        { id: 'pin-1', title: 'Fetched One', location: { directory: '/x' }, time: { created: 1, updated: 2 } },
      );

      await useSessionPinnedStore.getState().backfillMissingMetadata([
        { id: 'pin-2', title: 'From Catalog' } as never,
      ]);

      expect(getSessionCalls).toEqual(['pin-1']);
      const meta = useSessionPinnedStore.getState().metadataCache;
      expect(meta.get('pin-1')?.title).toBe('Fetched One');
      expect(meta.get('pin-1')?.directory).toBe('/x');
      // pin-2 was covered by the catalog and therefore not fetched
      expect(meta.has('pin-2')).toBe(false);
      const persisted = JSON.parse(mockStorage.getItem(META_KEY) ?? '[]');
      expect(persisted).toHaveLength(1);
      expect(persisted[0].title).toBe('Fetched One');
    });

    test('skips ids whose cached title is already present', async () => {
      memoryStore.set(STORAGE_KEY, JSON.stringify(['pin-1']));
      useSessionPinnedStore.setState({
        ids: new Set(['pin-1']),
        metadataCache: new Map([
          ['pin-1', { id: 'pin-1', title: 'Known', updatedAt: 1, cachedAt: 1 }],
        ]),
      });

      await useSessionPinnedStore.getState().backfillMissingMetadata([]);

      expect(getSessionCalls).toEqual([]);
    });

    test('no-op when there are no pinned ids', async () => {
      useSessionPinnedStore.setState({ ids: new Set(), metadataCache: new Map() });
      await useSessionPinnedStore.getState().backfillMissingMetadata([]);
      expect(getSessionCalls).toEqual([]);
    });
  });
});
