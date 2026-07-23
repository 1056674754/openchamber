import { describe, expect, test, mock } from 'bun:test';

import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionStatus } from '@opencode-ai/sdk/v2/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

// useGlobalSessionsStore pulls in @/lib/opencode/client, which has a circular
// dependency that surfaces as a TDZ ("Cannot access 'opencodeClient before
// initialization") inside useDirectoryStore at module-eval time.
// computeStatusBatchMerge is pure and never calls opencodeClient, so stubbing
// the client is sufficient to load the module under test.
mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    getSdkClient: () => ({}),
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
  });
});
