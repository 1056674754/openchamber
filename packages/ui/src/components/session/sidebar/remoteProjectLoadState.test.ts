import { beforeEach, describe, expect, mock, test } from 'bun:test';

const getSyncStoresForServer = mock((_serverId: string) => null as null | {
  getChild: (path: string) => { getState: () => { status: string } } | null;
});

mock.module('@/sync/multi-server-registry', () => ({
  getSyncStoresForServer,
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
