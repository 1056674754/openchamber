import { beforeEach, describe, expect, mock, test } from 'bun:test';

const getSyncStoresForServer = mock((serverId: string) => {
  void serverId;
  return null as null | {
    getChild: (path: string) => { getState: () => { status: string } } | null;
  };
});

// [fork-port] The stub must carry the module's full export surface: bun
// installs mock.module process-wide, and sidebar tests landed from upstream
// v1.24.2 pull the real registry transitively.
const registerSyncStores = mock(() => () => undefined);
const getAllSyncStores = mock(() => [] as never[]);
const subscribeSyncStoresRegistry = mock(() => () => undefined);

mock.module('@/sync/multi-server-registry', () => ({
  registerSyncStores,
  getAllSyncStores,
  getSyncStoresForServer,
  subscribeSyncStoresRegistry,
}));

const { getRemoteProjectLoadStates } = await import('./remoteProjectLoadState');

describe('getRemoteProjectLoadStates', () => {
  beforeEach(() => {
    getSyncStoresForServer.mockReset();
    getSyncStoresForServer.mockImplementation(() => null);
  });

  test('treats missing SyncProvider as complete (not infinite skeleton)', () => {
    const states = getRemoteProjectLoadStates([
      { id: 'p1', normalizedPath: '/repo', serverId: 'ssh-1' },
    ]);
    expect(states.get('p1')?.phase).toBe('complete');
  });

  test('reports loading when a live child store is still bootstrapping', () => {
    getSyncStoresForServer.mockImplementation(() => ({
      getChild: () => ({ getState: () => ({ status: 'loading' }) }),
    }));
    const states = getRemoteProjectLoadStates([
      { id: 'p1', normalizedPath: '/repo', serverId: 'ssh-1' },
    ]);
    expect(states.get('p1')?.phase).toBe('loading');
  });

  test('skips default/local projects', () => {
    const states = getRemoteProjectLoadStates([
      { id: 'local', normalizedPath: '/repo', serverId: 'default' },
      { id: 'local2', normalizedPath: '/repo' },
    ]);
    expect(states.size).toBe(0);
  });
});
