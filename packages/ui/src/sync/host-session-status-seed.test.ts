import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import {
  applyGlobalSessionStatusEvents,
  replaceGlobalSessionStatusById,
  useGlobalSessionStatusStore,
} from './global-session-status';
import {
  HOST_STATUS_SEED_MAX_AGE_MS,
  buildHostStatusSeedEvents,
  seedGlobalSessionStatusFromHost,
} from './host-session-status-seed';
import { resetSessionOrdering } from './session-ordering';
import { resetSessionActivityTiming } from './session-activity-timing';

const NOW = 1_700_000_000_000;

const session = (id: string, directory: string) => ({
  id, slug: id, directory, projectID: 'project', title: id, version: '1',
  time: { created: 1, updated: 1 },
});

describe('buildHostStatusSeedEvents', () => {
  test('adds busy and retry entries as busy, grouped by resolved directory', () => {
    const events = buildHostStatusSeedEvents({
      serverTime: NOW,
      sessions: {
        a: { status: 'busy', lastUpdateAt: NOW - 1_000 },
        b: { status: 'retry', lastUpdateAt: NOW - 1_000 },
        c: { status: 'idle', lastUpdateAt: NOW },
      },
    }, {
      isKnown: () => false,
      resolveDirectory: (id) => (id === 'a' ? '/repo' : id === 'b' ? '/other' : null),
    });

    expect([...events.keys()]).toEqual(['/repo', '/other']);
    expect(events.get('/repo')).toEqual([{
      id: 'host-seed:a',
      type: 'session.status',
      properties: { sessionID: 'a', status: { type: 'busy' } },
    }]);
    expect(events.get('/other')?.[0]?.properties).toEqual({ sessionID: 'b', status: { type: 'busy' } });
  });

  test('skips sessions the client already observed, stale entries, and unresolved directories', () => {
    const events = buildHostStatusSeedEvents({
      serverTime: NOW,
      sessions: {
        known: { status: 'busy', lastUpdateAt: NOW },
        stale: { status: 'busy', lastUpdateAt: NOW - HOST_STATUS_SEED_MAX_AGE_MS - 1 },
        fresh: { status: 'busy', lastUpdateAt: NOW - HOST_STATUS_SEED_MAX_AGE_MS },
        unplaced: { status: 'busy', lastUpdateAt: NOW },
      },
    }, {
      isKnown: (id) => id === 'known',
      resolveDirectory: (id) => (id === 'unplaced' ? null : '/repo'),
    });

    expect([...events.keys()]).toEqual(['/repo']);
    expect(events.get('/repo')).toEqual([{
      id: 'host-seed:fresh',
      type: 'session.status',
      properties: { sessionID: 'fresh', status: { type: 'busy' } },
    }]);
  });
});

describe('seedGlobalSessionStatusFromHost', () => {
  const originalGetSnapshot = opencodeClient.getHostSessionStatusSnapshot;

  beforeEach(() => {
    replaceGlobalSessionStatusById(new Map());
    resetSessionOrdering();
    resetSessionActivityTiming();
    useGlobalSessionsStore.setState({
      activeSessions: [session('s-local', '/repo'), session('s-gone', '/gone')],
      archivedSessions: [],
    });
  });

  afterEach(() => {
    opencodeClient.getHostSessionStatusSnapshot = originalGetSnapshot;
    replaceGlobalSessionStatusById(new Map());
    resetSessionOrdering();
    resetSessionActivityTiming();
    useGlobalSessionsStore.setState({ activeSessions: [], archivedSessions: [], sessionStatuses: new Map() });
  });

  test('seeds unobserved busy sessions into the status index and the global catalog', async () => {
    // A live event that already observed one session wins over the seed.
    applyGlobalSessionStatusEvents('/repo', [{
      type: 'session.status',
      properties: { sessionID: 's-live', status: { type: 'busy' } },
    } as never]);

    opencodeClient.getHostSessionStatusSnapshot = async () => ({
      serverTime: NOW,
      sessions: {
        's-local': { status: 'busy', lastUpdateAt: NOW - 1_000 },
        's-live': { status: 'busy', lastUpdateAt: NOW - 1_000 },
        's-gone': { status: 'idle', lastUpdateAt: NOW },
      },
      pending: {
        's-local': { permissions: [], questions: [] },
      },
    });

    await seedGlobalSessionStatusFromHost();

    const statusById = useGlobalSessionStatusStore.getState().statusById;
    expect(statusById.has('s-local')).toBe(true);
    // The live event won: the seed skipped the already-observed session and
    // the live entry stays untouched in the index.
    expect(statusById.get('s-live')?.directory).toBe('/repo');

    const globalStatuses = useGlobalSessionsStore.getState().sessionStatuses;
    expect(globalStatuses.get('s-local')?.type).toBe('busy');
    // The seed never merges an observed session into the catalog either.
    expect(globalStatuses.has('s-live')).toBe(false);
  });

  test('a failed host fetch preserves current state', async () => {
    opencodeClient.getHostSessionStatusSnapshot = async () => null;
    await seedGlobalSessionStatusFromHost();
    expect(useGlobalSessionStatusStore.getState().statusById.size).toBe(0);
    expect(useGlobalSessionsStore.getState().sessionStatuses.size).toBe(0);
  });
});
