import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { getSafeStorage } from '@/stores/utils/safeStorage';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { createSessionActivityKey } from './session-activity-key';
import {
  observeSessionActivityTiming,
  reconcileSessionActivityTiming,
  removeSessionActivityTiming,
  removeSessionActivityTimingForServer,
  resetSessionActivityTiming,
  useSessionActivityTimingStore,
} from './session-activity-timing';

const STORAGE_KEY = 'oc.session-activity.v1';
const SERVER_ID = DEFAULT_SERVER_ID;
const DIR = '/repo';
const OTHER_SERVER_ID = 'remote-server';
const OTHER_DIR = '/other';

const key = (sessionId: string): string => createSessionActivityKey(SERVER_ID, DIR, sessionId);

const startedAt = (sessionId: string): number | undefined =>
  useSessionActivityTimingStore.getState().startedAt.get(key(sessionId));

const settledMs = (sessionId: string): number | undefined =>
  useSessionActivityTimingStore.getState().settledMs.get(key(sessionId));

type PersistedStart = { start: number; seen: number };

const readPersisted = (): Record<string, PersistedStart> | null => {
  const raw = getSafeStorage().getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, PersistedStart>) : null;
};

/**
 * Seed a previous page session's record, then simulate the reload.
 * `loadedAgoMs` places this page's navigation start in the past, which is how a
 * slow bootstrap or an expired adoption window is expressed.
 */
const seedReload = (entries: Record<string, PersistedStart>, loadedAgoMs = 0): void => {
  getSafeStorage().setItem(STORAGE_KEY, JSON.stringify(entries));
  resetSessionActivityTiming({ pageLoadAt: Date.now() - loadedAgoMs });
};

/** A status snapshot: which sessions it reports busy, and which it covers. */
const snapshot = (activeIds: string[], coveredIds: string[] = activeIds): void => {
  const covered = new Set(coveredIds);
  reconcileSessionActivityTiming(SERVER_ID, DIR, new Set(activeIds), (sessionId) => covered.has(sessionId));
};

/** A record for a turn that began `ageMs` ago and was alive until the reload. */
const runningUntilReload = (ageMs: number, loadedAgoMs = 0, quietFor = 1_000): PersistedStart => ({
  start: Date.now() - ageMs,
  seen: Date.now() - loadedAgoMs - quietFor,
});

beforeEach(() => {
  getSafeStorage().removeItem(STORAGE_KEY);
  resetSessionActivityTiming();
});

afterEach(() => {
  getSafeStorage().removeItem(STORAGE_KEY);
  resetSessionActivityTiming();
});

describe('session activity timing', () => {
  test('starts a turn on the first active observation and keeps it stable', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    const first = startedAt('ses_a');
    expect(first).toBeGreaterThan(0);

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    expect(startedAt('ses_a')).toBe(first);
  });

  test('settling converts the start into a duration', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');

    expect(startedAt('ses_a')).toBe(undefined);
    expect(settledMs('ses_a')).toBeGreaterThanOrEqual(0);
  });

  test('a new turn clears the previous settled duration', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');
    expect(settledMs('ses_a')).toBeDefined();

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    expect(settledMs('ses_a')).toBe(undefined);
    expect(startedAt('ses_a')).toBeDefined();
  });

  test('settling a session that was never observed active yields no duration', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');

    expect(startedAt('ses_a')).toBe(undefined);
    expect(settledMs('ses_a')).toBe(undefined);
  });

  test('snapshot reconciliation starts covered actives and settles the rest', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_b', 'active');

    snapshot(['ses_a'], ['ses_a', 'ses_b', 'ses_c']);

    expect(startedAt('ses_a')).toBeDefined();
    expect(startedAt('ses_b')).toBe(undefined);
    expect(settledMs('ses_b')).toBeGreaterThanOrEqual(0);
    expect(settledMs('ses_c')).toBe(undefined);
  });

  test('a session outside the snapshot scope keeps running', () => {
    observeSessionActivityTiming(SERVER_ID, OTHER_DIR, 'ses_other_directory', 'active');
    const start = useSessionActivityTimingStore.getState().startedAt.get(
      createSessionActivityKey(SERVER_ID, OTHER_DIR, 'ses_other_directory'),
    );

    snapshot([], ['ses_a']);

    expect(useSessionActivityTimingStore.getState().startedAt.get(
      createSessionActivityKey(SERVER_ID, OTHER_DIR, 'ses_other_directory'),
    )).toBe(start);
  });

  test('persists the start and a liveness stamp for a running turn', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');

    const persisted = readPersisted();
    expect(persisted?.[key('ses_a')].start).toBe(startedAt('ses_a') as number);
    expect(persisted?.[key('ses_a')].seen).toBeGreaterThanOrEqual(persisted?.[key('ses_a')].start as number);
  });

  test('clears the persisted record when the turn ends', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');

    expect(readPersisted()).toBeNull();
  });

  test('resumes a persisted start when a status snapshot reports the session active', () => {
    const record = runningUntilReload(90_000);
    seedReload({ [key('ses_a')]: record });

    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBe(record.start);
  });

  test('resumes when a repeated busy event arrives before the first snapshot', () => {
    const record = runningUntilReload(90_000);
    seedReload({ [key('ses_a')]: record });

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');

    expect(startedAt('ses_a')).toBe(record.start);
  });

  test('the turn after a resumed one still counts from zero', () => {
    const record = runningUntilReload(90_000);
    seedReload({ [key('ses_a')]: record });

    snapshot(['ses_a'], ['ses_a']);
    expect(startedAt('ses_a')).toBe(record.start);

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');
    const before = Date.now();
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('a live idle event retires the persisted record', () => {
    const record = runningUntilReload(90_000);
    seedReload({ [key('ses_a')]: record });

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'settled');
    const before = Date.now();
    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('resumes even when bootstrap takes most of a minute', () => {
    const loadedAgoMs = 45_000;
    const record = runningUntilReload(300_000, loadedAgoMs);
    seedReload({ [key('ses_a')]: record }, loadedAgoMs);

    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBe(record.start);
  });

  test('does not adopt a record once the adoption window has passed', () => {
    const loadedAgoMs = 5 * 60_000;
    const record = runningUntilReload(300_000, loadedAgoMs);
    seedReload({ [key('ses_a')]: record }, loadedAgoMs);

    const before = Date.now();
    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('an early snapshot that cannot see the session busy does not lose the start', () => {
    const record = runningUntilReload(120_000);
    seedReload({ [key('ses_a')]: record });

    reconcileSessionActivityTiming(SERVER_ID, DIR, new Set(), (sessionId) => sessionId === 'ses_a');
    reconcileSessionActivityTiming(
      SERVER_ID, DIR,
      new Set(['ses_a']),
      () => true,
    );

    expect(startedAt('ses_a')).toBe(record.start);
  });

  test('resumes through a snapshot that arrives before the session list loads', () => {
    const record = runningUntilReload(120_000);
    seedReload({ [key('ses_a')]: record });

    reconcileSessionActivityTiming(SERVER_ID, DIR, new Set(['ses_a']), () => false);

    expect(startedAt('ses_a')).toBe(record.start);
  });

  test('does not resume a record whose liveness stamp has gone quiet', () => {
    const before = Date.now();
    seedReload({ [key('ses_a')]: { start: before - 300_000, seen: before - 240_000 } });

    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('does not resume a turn older than the maximum turn age', () => {
    const before = Date.now();
    seedReload({ [key('ses_a')]: { start: before - 48 * 60 * 60 * 1000, seen: before - 1_000 } });

    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('ignores malformed persisted payloads', () => {
    getSafeStorage().setItem(STORAGE_KEY, 'not json');
    resetSessionActivityTiming();

    const before = Date.now();
    snapshot(['ses_a'], ['ses_a']);

    expect(startedAt('ses_a')).toBeGreaterThanOrEqual(before);
  });

  test('ignores entries of the wrong shape or dated in the future', () => {
    const before = Date.now();
    seedReload({
      [key('ses_a')]: before as unknown as PersistedStart,
      [key('ses_b')]: { start: 'nope', seen: before },
      [key('ses_c')]: { start: before + 60_000, seen: before },
      [key('ses_d')]: { start: before - 5_000, seen: before + 60_000 },
    } as Record<string, PersistedStart>);

    for (const sessionId of ['ses_a', 'ses_b', 'ses_c', 'ses_d']) {
      snapshot([sessionId]);
      expect(startedAt(sessionId)).toBeGreaterThanOrEqual(before);
    }
  });

  test('a quiet record ages out of storage on the next write', () => {
    const before = Date.now();
    seedReload({ [key('ses_quiet')]: { start: before - 300_000, seen: before - 240_000 } });

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');

    expect(readPersisted()?.[key('ses_quiet')]).toBe(undefined);
    expect(readPersisted()?.[key('ses_a')].start).toBeDefined();
  });

  test('deleting a session clears live, settled, and persisted timing', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_b', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_b', 'settled');

    removeSessionActivityTiming(SERVER_ID, DIR, 'ses_a');
    removeSessionActivityTiming(SERVER_ID, DIR, 'ses_b');

    expect(startedAt('ses_a')).toBe(undefined);
    expect(settledMs('ses_b')).toBe(undefined);
    expect(readPersisted()).toBeNull();
  });

  test('unrelated sessions keep their map references across a no-op update', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    const before = useSessionActivityTimingStore.getState();

    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_unknown', 'settled');

    const after = useSessionActivityTimingStore.getState();
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.settledMs).toBe(before.settledMs);
  });
});

// [sscity-mod] Multi-instance isolation: records from one server must not leak
// to another, and snapshot reconciliation for one server must not settle turns
// belonging to a different server.
describe('session activity timing — multi-instance isolation', () => {
  test('sessions on different servers are tracked independently', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_a', 'active');
    observeSessionActivityTiming(OTHER_SERVER_ID, DIR, 'ses_a', 'active');

    const localKey = createSessionActivityKey(SERVER_ID, DIR, 'ses_a');
    const remoteKey = createSessionActivityKey(OTHER_SERVER_ID, DIR, 'ses_a');
    const localStart = useSessionActivityTimingStore.getState().startedAt.get(localKey);
    const remoteStart = useSessionActivityTimingStore.getState().startedAt.get(remoteKey);

    expect(localStart).toBeDefined();
    expect(remoteStart).toBeDefined();
    expect(localKey).not.toBe(remoteKey);
  });

  test('a snapshot for one server does not settle another server’s turn', () => {
    observeSessionActivityTiming(OTHER_SERVER_ID, DIR, 'ses_remote', 'active');
    const remoteKey = createSessionActivityKey(OTHER_SERVER_ID, DIR, 'ses_remote');
    const remoteStart = useSessionActivityTimingStore.getState().startedAt.get(remoteKey);

    // Local snapshot reports nothing active and covers ses_remote — but ses_remote
    // belongs to a different server, so the local snapshot has no authority.
    snapshot([], ['ses_remote']);

    expect(useSessionActivityTimingStore.getState().startedAt.get(remoteKey)).toBe(remoteStart);
  });

  test('removeSessionActivityTimingForServer clears only that server’s records', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_local', 'active');
    observeSessionActivityTiming(OTHER_SERVER_ID, DIR, 'ses_remote', 'active');

    removeSessionActivityTimingForServer(OTHER_SERVER_ID);

    expect(startedAt('ses_local')).toBeDefined();
    expect(useSessionActivityTimingStore.getState().startedAt.get(
      createSessionActivityKey(OTHER_SERVER_ID, DIR, 'ses_remote'),
    )).toBeUndefined();
  });

  test('removeSessionActivityTimingForServer clears persisted records too', () => {
    observeSessionActivityTiming(SERVER_ID, DIR, 'ses_local', 'active');
    observeSessionActivityTiming(OTHER_SERVER_ID, DIR, 'ses_remote', 'active');

    removeSessionActivityTimingForServer(OTHER_SERVER_ID);

    const persisted = readPersisted();
    expect(persisted?.[createSessionActivityKey(SERVER_ID, DIR, 'ses_local')]).toBeDefined();
    expect(persisted?.[createSessionActivityKey(OTHER_SERVER_ID, DIR, 'ses_remote')]).toBeUndefined();
  });
});
