import { beforeEach, describe, expect, mock, test } from 'bun:test';

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
}));

const { useSessionPinnedStore } = await import('./useSessionPinnedStore');

const resetStore = () => {
  useSessionPinnedStore.setState({ ids: new Set<string>() });
};

describe('useSessionPinnedStore', () => {
  beforeEach(() => {
    memoryStore.clear();
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
});
