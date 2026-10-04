import { describe, expect, test, mock } from 'bun:test';

import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionStatus } from '@opencode-ai/sdk/v2/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import type { SessionListRequest } from './globalSessions';

let mockedSdkClient: unknown = {};

// useGlobalSessionsStore pulls in @/lib/opencode/client, which has a circular
// dependency that surfaces as a TDZ ("Cannot access 'opencodeClient before
// initialization") inside useDirectoryStore at module-eval time.
// computeStatusBatchMerge is pure and never calls opencodeClient, so stubbing
// the client is sufficient to load the module under test.
mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getSdkClient: () => mockedSdkClient,
    setDirectory: () => {},
    getDirectory: () => '',
  },
}));

const { computeStatusBatchMerge, mergeLiveSessionWithGlobalSession, useGlobalSessionsStore } = await import('./useGlobalSessionsStore');

type Result = PromiseSettledResult<{ directory: string; response: unknown }>;

const DIR_A = '/projects/alpha';
const DIR_B = '/projects/beta';

const busy: SessionStatus = { type: 'busy' };
const idle: SessionStatus = { type: 'idle' };
const retry: SessionStatus = { type: 'retry', attempt: 2, message: 'rate', next: 10 };

const makeSession = (id: string, directory: string): Session => ({
  id,
  slug: id,
  projectID: 'proj',
  directory,
  title: id,
  version: 'v1',
  time: { created: 1, updated: 2 },
});

const resetCatalog = (): void => {
  useGlobalSessionsStore.setState({
    activeSessions: [],
    archivedSessions: [],
    sessionsByDirectory: new Map(),
    childLoadState: new Map(),
    archivedLoadState: new Map(),
    sessionStatuses: new Map(),
    hasLoaded: false,
    isCompleteSnapshot: false,
    completeSnapshotScopes: new Set(),
    catalogRevision: 0,
    sessionEventRevision: {},
    sessionDeletedRevision: {},
    status: 'idle',
  });
};

const fulfilled = (directory: string, response: unknown): Result => ({
  status: 'fulfilled',
  value: { directory, response },
});

const rejected = (reason: unknown): Result => ({
  status: 'rejected',
  reason,
});

const merge = (
  currentStatuses: Map<string, SessionStatus>,
  sessionsByDirectory: Map<string, readonly Session[]>,
  results: ReadonlyArray<Result>,
) =>
  computeStatusBatchMerge({
    currentStatuses,
    sessionsByDirectory,
    results,
  });

describe('computeStatusBatchMerge', () => {
  test('prunes stale statuses scoped to a fulfilled directory payload', () => {
    // s1 and s2 belong to DIR_A. Both are busy. The fresh payload for DIR_A
    // no longer reports s2 (the child stopped), so s2 is stale and must be
    // pruned. s3 belongs to DIR_B and must be untouched.
    const current = new Map<string, SessionStatus>([
      ['s1', busy],
      ['s2', busy],
      ['s3', busy],
    ]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A), makeSession('s2', DIR_A)]],
      [DIR_B, [makeSession('s3', DIR_B)]],
    ]);
    const results: Result[] = [fulfilled(DIR_A, { data: { s1: idle } })];

    const next = merge(current, byDir, results);

    expect(next).not.toBeNull();
    const map = next as Map<string, SessionStatus>;
    expect(map.get('s1')).toEqual(idle);
    expect(map.has('s2')).toBe(false);
    expect(map.get('s3')).toEqual(busy);
  });

  test('preserves all statuses when a directory result is rejected', () => {
    const current = new Map<string, SessionStatus>([
      ['s1', busy],
      ['s2', busy],
    ]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A), makeSession('s2', DIR_A)]],
    ]);
    const results: Result[] = [rejected(new Error('network'))];

    const next = merge(current, byDir, results);

    expect(next).toBeNull();
    expect(current.get('s1')).toEqual(busy);
    expect(current.get('s2')).toEqual(busy);
  });

  test('preserves statuses for null, array, and non-object data responses', () => {
    const current = new Map<string, SessionStatus>([['s1', busy]]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A)]],
      [DIR_B, [makeSession('s2', DIR_B)]],
    ]);
    const results: Result[] = [
      fulfilled(DIR_A, null),
      fulfilled(DIR_B, { data: [{ id: 's2' }] }),
      fulfilled('/projects/gamma', { data: 'nope' }),
    ];

    const next = merge(current, byDir, results);

    expect(next).toBeNull();
    expect(current.get('s1')).toEqual(busy);
  });

  test('returns null (preserving reference) when nothing changes', () => {
    const current = new Map<string, SessionStatus>([
      ['s1', idle],
      ['s2', busy],
    ]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A), makeSession('s2', DIR_A)]],
    ]);
    const results: Result[] = [fulfilled(DIR_A, { data: { s1: idle, s2: busy } })];

    const next = merge(current, byDir, results);

    expect(next).toBeNull();
  });

  test('upserts new and changed statuses', () => {
    const current = new Map<string, SessionStatus>([['s1', busy]]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A)]],
    ]);
    const results: Result[] = [
      fulfilled(DIR_A, { data: { s1: retry, s2: idle } }),
    ];

    const next = merge(current, byDir, results);

    expect(next).not.toBeNull();
    const map = next as Map<string, SessionStatus>;
    expect(map.get('s1')).toEqual(retry);
    expect(map.get('s2')).toEqual(idle);
  });

  test('does not prune statuses for sessions absent from sessionsByDirectory', () => {
    // s1 has a status but is not attributed to any directory (mapping
    // missing). A fresh DIR_A payload that does not mention s1 must NOT
    // prune s1, since its directory ownership is unknown.
    const current = new Map<string, SessionStatus>([['s1', busy]]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s2', DIR_A)]],
    ]);
    const results: Result[] = [fulfilled(DIR_A, { data: {} })];

    const next = merge(current, byDir, results);

    expect(next).toBeNull();
    expect(current.get('s1')).toEqual(busy);
  });

  test('prunes only the fulfilled directory, leaving a rejected directory intact', () => {
    // DIR_A fulfilled (s1 stale → prune). DIR_B rejected (s2 must survive).
    const current = new Map<string, SessionStatus>([
      ['s1', busy],
      ['s2', busy],
    ]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A)]],
      [DIR_B, [makeSession('s2', DIR_B)]],
    ]);
    const results: Result[] = [
      fulfilled(DIR_A, { data: {} }),
      rejected(new Error('boom')),
    ];

    const next = merge(current, byDir, results);

    expect(next).not.toBeNull();
    const map = next as Map<string, SessionStatus>;
    expect(map.has('s1')).toBe(false);
    expect(map.get('s2')).toEqual(busy);
  });

  test('scopes pruning by server when two remotes expose the same directory', () => {
    const current = new Map<string, SessionStatus>([
      ['s1', busy],
      ['s2', busy],
    ]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A), makeSession('s2', DIR_A)]],
    ]);
    const next = computeStatusBatchMerge({
      currentStatuses: current,
      sessionsByDirectory: byDir,
      serverIdBySession: new Map([
        ['s1', 'remote-a'],
        ['s2', 'remote-b'],
      ]),
      results: [{
        status: 'fulfilled',
        value: { directory: DIR_A, serverId: 'remote-a', response: { data: {} } },
      }],
    });

    expect(next?.has('s1')).toBe(false);
    expect(next?.get('s2')).toEqual(busy);
  });

  test('never mutates the input currentStatuses map', () => {
    const current = new Map<string, SessionStatus>([['s1', busy]]);
    const byDir = new Map<string, readonly Session[]>([
      [DIR_A, [makeSession('s1', DIR_A), makeSession('s2', DIR_A)]],
    ]);
    const results: Result[] = [fulfilled(DIR_A, { data: { s2: idle } })];

    const next = merge(current, byDir, results);

    expect(next).not.toBe(current);
    expect(current.get('s1')).toEqual(busy);
    expect(current.has('s2')).toBe(false);
    expect(current.size).toBe(1);
  });
});

describe('mergeLiveSessionWithGlobalSession', () => {
  test('uses the authoritative global share state while preserving live fields', () => {
    const live = {
      ...makeSession('s1', DIR_A),
      share: { url: 'https://live.example/s1' },
      time: { created: 1, updated: 5 },
    };
    const global = {
      ...makeSession('s1', DIR_A),
      share: undefined,
      time: { created: 1, updated: 3 },
    };

    const merged = mergeLiveSessionWithGlobalSession(live, global);

    expect(merged.share).toBe(undefined);
    expect(merged.time.updated).toBe(5);
  });
});

describe('upsertSession freshness', () => {
  test('preserves a newer session when a stale SSE echo arrives', () => {
    const current = {
      ...makeSession('s1', DIR_A),
      title: 'New Title',
      time: { created: 1, updated: 20 },
    };
    const incoming = {
      ...current,
      title: 'Old Title',
      time: { created: 1, updated: 10 },
    };
    useGlobalSessionsStore.setState({
      activeSessions: [current],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [current]]]),
    });

    useGlobalSessionsStore.getState().upsertSession(incoming);

    expect(useGlobalSessionsStore.getState().activeSessions[0]).toBe(current);
  });
});

describe('applyRemoteDirectorySnapshot', () => {
  test('replaces only the matching server and directory', () => {
    resetCatalog();
    const local = makeSession('local-session', DIR_A);
    const previousA = makeSession('remote-a-old', DIR_A);
    const remoteB = makeSession('remote-b-session', DIR_A);
    const nextA = makeSession('remote-a-new', DIR_A);
    serverRegistry.indexSession(local.id, DEFAULT_SERVER_ID);
    serverRegistry.indexSession(previousA.id, 'remote-a');
    serverRegistry.indexSession(remoteB.id, 'remote-b');
    useGlobalSessionsStore.setState({
      activeSessions: [local, previousA, remoteB],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [local, previousA, remoteB]]]),
      sessionStatuses: new Map([[previousA.id, busy]]),
    });

    useGlobalSessionsStore.getState().applyRemoteDirectorySnapshot('remote-a', DIR_A, [nextA]);

    const state = useGlobalSessionsStore.getState();
    expect(state.activeSessions.map((session) => session.id).sort()).toEqual([
      'local-session',
      'remote-a-new',
      'remote-b-session',
    ]);
    expect(state.sessionStatuses.has(previousA.id)).toBe(false);
    expect(serverRegistry.getServerForSession(nextA.id)).toBe('remote-a');
    expect(state.isScopeSnapshotComplete('remote-a', DIR_A)).toBe(true);
  });

  test('successful empty snapshot clears only that remote scope', () => {
    resetCatalog();
    const local = makeSession('local-session', DIR_A);
    const remote = makeSession('remote-a-old', DIR_A);
    serverRegistry.indexSession(local.id, DEFAULT_SERVER_ID);
    serverRegistry.indexSession(remote.id, 'remote-a');
    useGlobalSessionsStore.setState({
      activeSessions: [local, remote],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [local, remote]]]),
      hasLoaded: true,
    });

    useGlobalSessionsStore.getState().applyRemoteDirectorySnapshot('remote-a', DIR_A, []);

    const state = useGlobalSessionsStore.getState();
    expect(state.activeSessions.map((session) => session.id)).toEqual(['local-session']);
    expect(state.isScopeSnapshotComplete('remote-a', DIR_A)).toBe(true);
  });

  test('preserves an in-flight create that raced the list response', () => {
    resetCatalog();
    const listed = makeSession('listed', DIR_A);
    const live = makeSession('live-create', DIR_A);
    serverRegistry.indexSession(listed.id, 'remote-a');
    serverRegistry.indexSession(live.id, 'remote-a');
    useGlobalSessionsStore.setState({
      activeSessions: [live],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [live]]]),
      catalogRevision: 4,
      sessionEventRevision: { [live.id]: 5 },
    });

    useGlobalSessionsStore.getState().applyRemoteDirectorySnapshot('remote-a', DIR_A, [listed], {
      baselineRevision: 4,
    });

    expect(useGlobalSessionsStore.getState().activeSessions.map((session) => session.id).sort()).toEqual([
      'listed',
      'live-create',
    ]);
  });

  test('does not resurrect a session deleted after the list request started', () => {
    resetCatalog();
    const deleted = makeSession('deleted', DIR_A);
    serverRegistry.indexSession(deleted.id, 'remote-a');
    useGlobalSessionsStore.setState({
      activeSessions: [],
      archivedSessions: [],
      sessionsByDirectory: new Map(),
      catalogRevision: 3,
      sessionDeletedRevision: { [deleted.id]: 3 },
    });

    useGlobalSessionsStore.getState().applyRemoteDirectorySnapshot('remote-a', DIR_A, [deleted], {
      baselineRevision: 2,
    });

    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([]);
  });
});

describe('applyDirectorySnapshot isolation', () => {
  test('same-path local and remote catalogs do not prune each other', () => {
    resetCatalog();
    const local = makeSession('local-same-path', DIR_A);
    const remote = makeSession('remote-same-path', DIR_A);
    serverRegistry.indexSession(local.id, DEFAULT_SERVER_ID);
    serverRegistry.indexSession(remote.id, 'remote-a');
    useGlobalSessionsStore.setState({
      activeSessions: [local, remote],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [local, remote]]]),
      hasLoaded: true,
    });

    useGlobalSessionsStore.getState().applyDirectorySnapshot(DEFAULT_SERVER_ID, DIR_A, [
      makeSession('local-next', DIR_A),
    ]);

    const state = useGlobalSessionsStore.getState();
    expect(state.activeSessions.map((session) => session.id).sort()).toEqual([
      'local-next',
      'remote-same-path',
    ]);
    expect(state.isCompleteSnapshot).toBe(true);
    expect(state.isScopeSnapshotComplete(DEFAULT_SERVER_ID, DIR_A)).toBe(true);
    expect(state.isScopeSnapshotComplete('remote-a', DIR_A)).toBe(false);
  });
});

describe('loadSessions completeness', () => {
  test('marks a successful roots load as a complete snapshot', async () => {
    resetCatalog();
    mockedSdkClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [makeSession('root', DIR_A)],
            response: { headers: new Headers() },
          }),
        },
      },
    };

    await useGlobalSessionsStore.getState().loadSessions();

    expect(useGlobalSessionsStore.getState().isCompleteSnapshot).toBe(true);
    expect(useGlobalSessionsStore.getState().status).toBe('ready');
  });

  test('failed fetch preserves existing catalog and does not mark complete', async () => {
    resetCatalog();
    const existing = makeSession('keep-me', DIR_A);
    serverRegistry.indexSession(existing.id, DEFAULT_SERVER_ID);
    useGlobalSessionsStore.setState({
      activeSessions: [existing],
      archivedSessions: [],
      sessionsByDirectory: new Map([[DIR_A, [existing]]]),
      hasLoaded: true,
      isCompleteSnapshot: false,
      status: 'ready',
    });
    mockedSdkClient = {
      experimental: {
        session: {
          list: async () => {
            throw new Error('network down');
          },
        },
      },
    };

    await useGlobalSessionsStore.getState().loadSessions();

    const state = useGlobalSessionsStore.getState();
    expect(state.activeSessions.map((session) => session.id)).toEqual(['keep-me']);
    expect(state.isCompleteSnapshot).toBe(false);
    expect(state.status).toBe('error');
  });
});

describe('demand-loaded session catalog', () => {
  test('bootstraps with one root-only page even when a cursor is present', async () => {
    resetCatalog();
    const requests: SessionListRequest[] = [];
    mockedSdkClient = {
      experimental: {
        session: {
          list: async (request: SessionListRequest) => {
            requests.push(request);
            return {
              data: [makeSession('root', DIR_A)],
              response: { headers: new Headers({ 'x-next-cursor': '1' }) },
            };
          },
        },
      },
    };

    await useGlobalSessionsStore.getState().loadSessions();

    expect(requests).toEqual([{
      archived: true,
      roots: true,
      limit: 200,
    }]);
    expect(useGlobalSessionsStore.getState().activeSessions.map((session) => session.id)).toEqual(['root']);
  });

  test('preserves an SSE upsert that arrives while roots are loading', async () => {
    resetCatalog();
    const deferred: {
      resolve?: (value: { data: Session[] }) => void;
    } = {};
    mockedSdkClient = {
      experimental: {
        session: {
          list: () => new Promise<{ data: Session[] }>((resolve) => {
            deferred.resolve = resolve;
          }),
        },
      },
    };

    const load = useGlobalSessionsStore.getState().loadSessions();
    useGlobalSessionsStore.getState().upsertSession(makeSession('live-during-load', DIR_B));
    // The page request runs through the background-network limiter, so it
    // starts on a later microtask — poll for it instead of asserting sync.
    let resolveList = deferred.resolve;
    for (let waited = 0; !resolveList && waited < 2000; waited += 10) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      resolveList = deferred.resolve;
    }
    if (!resolveList) throw new Error('session list request did not start');
    resolveList({ data: [makeSession('root', DIR_A)] });
    await load;

    expect(useGlobalSessionsStore.getState().activeSessions.map((session) => session.id).sort()).toEqual([
      'live-during-load',
      'root',
    ]);
  });

  test('loads children once and merges them without replacing roots', async () => {
    resetCatalog();
    const parent = makeSession('parent-demand', DIR_A);
    const child = {
      ...makeSession('child-demand', DIR_A),
      parentID: parent.id,
    };
    let childRequests = 0;
    mockedSdkClient = {
      session: {
        children: async () => {
          childRequests += 1;
          return { data: [child] };
        },
      },
    };
    serverRegistry.indexSession(parent.id, DEFAULT_SERVER_ID);
    useGlobalSessionsStore.setState({
      activeSessions: [parent],
      sessionsByDirectory: new Map([[DIR_A, [parent]]]),
    });

    await useGlobalSessionsStore.getState().loadSessionChildren(parent);
    await useGlobalSessionsStore.getState().loadSessionChildren(parent);

    expect(childRequests).toBe(1);
    expect(useGlobalSessionsStore.getState().activeSessions.map((session) => session.id).sort()).toEqual([
      'child-demand',
      'parent-demand',
    ]);
    expect(useGlobalSessionsStore.getState().childLoadState.get(parent.id)).toBe('loaded');
  });

  test('filters active roots out of the include-archived response', async () => {
    resetCatalog();
    const active = makeSession('active-root', DIR_A);
    const archived = {
      ...makeSession('archived-root', DIR_A),
      time: { created: 1, updated: 2, archived: 3 },
    };
    mockedSdkClient = {
      experimental: {
        session: {
          list: async () => ({ data: [active, archived] }),
        },
      },
    };

    await useGlobalSessionsStore.getState().loadArchivedSessions(DEFAULT_SERVER_ID, true);

    expect(useGlobalSessionsStore.getState().archivedSessions.map((session) => session.id)).toEqual([
      'archived-root',
    ]);
    expect(useGlobalSessionsStore.getState().activeSessions).toEqual([]);
  });
});
