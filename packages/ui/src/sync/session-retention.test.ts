import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { buildSessionRetentionCandidates } from './session-retention';

const now = Date.now();
const day = 86_400_000;
const session = (id: string, patch: Partial<Session> = {}): Session => ({
  id, slug: id, projectID: 'project', directory: '/retention-project', title: id, version: '1',
  time: { created: now - 60 * day, updated: now - 40 * day }, ...patch,
});
const recent = Array.from({ length: 5 }, (_, index) => session(`recent-${index}`, {
  time: { created: now - day, updated: now - day },
}));
const archived = (id: string, patch: Partial<Session> = {}): Session => session(id, {
  time: { created: now - 60 * day, updated: now - 40 * day, archived: now - 40 * day }, ...patch,
});
const recentArchived = recent.map((item) => ({ ...item, id: `archived-${item.id}`, time: { ...item.time, archived: now - day } }));
const candidates = (sessions: Session[], action: 'archive' | 'delete' = 'delete') => buildSessionRetentionCandidates({
  sessions: [...recent, ...sessions], cutoffDays: 30, currentSessionId: null, action, activeSessionIds: new Set(), now,
});

describe('retention eligibility', () => {
  test('retains recent, current, shared, archived and running sessions', () => {
    const sessions = [
      session('old'), session('current'), session('shared', { share: { url: 'https://share.test' } }),
      session('archived', { time: { created: 1, updated: 2, archived: 3 } }), session('busy'),
    ];
    expect(buildSessionRetentionCandidates({
      sessions: [...recent, ...sessions], cutoffDays: 30, currentSessionId: 'current', action: 'delete',
      activeSessionIds: new Set(['busy']), now,
    })).toEqual(['old']);
  });

  test('protects every ancestor of a recent, shared or archived child from cascade deletion', () => {
    for (const child of [recent[0], session('shared', { share: { url: 'https://share.test' } }),
      session('archived', { time: { created: 1, updated: 2, archived: 3 } })]) {
      expect(candidates([
        session('root'), session('middle', { parentID: 'root' }), { ...child, parentID: 'middle' }, session('unrelated'),
      ])).toEqual(['unrelated']);
    }
  });

  test('archives old parents independently because archiving does not cascade', () => {
    expect(candidates([session('root'), { ...recent[0], parentID: 'root' }], 'archive')).toEqual(['root']);
  });

  test('retains parents with an attached side conversation for either action', () => {
    const parent = session('parent', { metadata: { openchamber: { btwSessionID: 'side' } } });
    expect(candidates([parent])).toEqual([]);
    expect(candidates([parent], 'archive')).toEqual([]);
  });

  test('orders descendants before ancestors regardless of timestamps or list order', () => {
    expect(candidates([session('root'), session('child', { parentID: 'root' }), session('leaf', { parentID: 'child' })]))
      .toEqual(['leaf', 'child', 'root']);
  });

  test('rejects invalid retention periods and cycles', () => {
    for (const cutoffDays of [0, -1, NaN, Infinity]) {
      expect(buildSessionRetentionCandidates({
        sessions: [session('old')], cutoffDays, currentSessionId: null, action: 'delete', activeSessionIds: new Set(), now,
      })).toEqual([]);
    }
    expect(candidates([session('a', { parentID: 'b' }), session('b', { parentID: 'a' })])).toEqual([]);
  });
});

describe('archived-only retention', () => {
  const archivedCandidates = (sessions: Session[]) => buildSessionRetentionCandidates({
    sessions: [...recentArchived, ...sessions], cutoffDays: 30, currentSessionId: null,
    action: 'archive', onlyArchived: true, activeSessionIds: new Set(), now,
  });

  test('filters only archived sessions and uses archive time instead of last activity', () => {
    expect(archivedCandidates([
      archived('old-archive', { time: { created: 1, updated: now, archived: now - 40 * day } }),
      archived('new-archive', { time: { created: 1, updated: 2, archived: now - 2 * day } }),
      session('unarchived'),
      session('restored', { time: { created: 1, updated: 2, archived: 0 } }),
    ])).toEqual(['old-archive']);
  });

  test('preserves the five most recently archived sessions even when all are expired', () => {
    const sessions = Array.from({ length: 7 }, (_, index) => archived(`archived-${index}`, {
      time: { created: 1, updated: now, archived: now - (40 + index) * day },
    }));
    expect(buildSessionRetentionCandidates({
      sessions, cutoffDays: 30, currentSessionId: null, action: 'delete', onlyArchived: true, activeSessionIds: new Set(), now,
    })).toEqual(['archived-5', 'archived-6']);
  });

  test('protects shared archives and parents of unarchived or recently archived descendants', () => {
    expect(archivedCandidates([
      archived('parent'), session('active-child', { parentID: 'parent' }),
      archived('recent-parent'), { ...recentArchived[0], parentID: 'recent-parent' },
      archived('shared', { share: { url: 'https://share.test' } }),
      archived('unrelated'),
    ])).toEqual(['unrelated']);
  });
});
