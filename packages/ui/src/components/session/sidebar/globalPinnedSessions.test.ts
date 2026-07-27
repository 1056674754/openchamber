import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { createPinnedSessionStub, resolveGlobalPinnedSessions } from './globalPinnedSessions';

const session = (id: string, title = id): Session => ({
  id,
  title,
  time: { created: 1, updated: 2 },
} as Session);

describe('resolveGlobalPinnedSessions', () => {
  test('returns empty when no pins', () => {
    expect(resolveGlobalPinnedSessions({
      pinnedIds: [],
      pinnedOrder: [],
      catalogs: [[session('a')]],
    })).toEqual([]);
  });

  test('orders by pinnedOrder then appends unordered pins', () => {
    const a = session('a');
    const b = session('b');
    const c = session('c');
    const resolved = resolveGlobalPinnedSessions({
      pinnedIds: ['a', 'b', 'c'],
      pinnedOrder: ['c', 'a'],
      catalogs: [[a, b, c]],
    });
    expect(resolved.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(resolved[0]).toBe(c);
  });

  test('uses unfiltered catalogs and stubs missing ids', () => {
    const visible = session('visible');
    const hidden = session('hidden');
    const resolved = resolveGlobalPinnedSessions({
      pinnedIds: ['visible', 'hidden', 'missing'],
      pinnedOrder: ['missing', 'hidden', 'visible'],
      catalogs: [[visible], [hidden]],
      stubTitle: 'Stub',
    });
    expect(resolved.map((item) => item.id)).toEqual(['missing', 'hidden', 'visible']);
    expect(resolved[0]?.title).toBe('Stub');
    expect(resolved[1]).toBe(hidden);
    expect(resolved[2]).toBe(visible);
  });

  test('createPinnedSessionStub sets id and title', () => {
    const stub = createPinnedSessionStub('ses_x', 'Pinned');
    expect(stub.id).toBe('ses_x');
    expect(stub.title).toBe('Pinned');
  });
});
