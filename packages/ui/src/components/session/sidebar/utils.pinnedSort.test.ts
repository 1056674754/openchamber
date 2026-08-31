import { describe, expect, mock, test } from 'bun:test';

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const {
  compareSessionsByPinnedAndTime,
  compareSessionsByPinnedAndCreated,
  compareSessions,
} = await import('./utils');

import type { Session } from '@opencode-ai/sdk/v2';

const makeSession = (id: string, createdAt: number, updatedAt?: number): Session =>
  ({
    id,
    title: id,
    time: { created: createdAt, updated: updatedAt ?? createdAt },
  }) as unknown as Session;

// Sessions used across tests — timestamps are distinct to make fallback
// (created-time) ordering deterministic.
const OLD_PINNED = makeSession('old-pinned', 1000);
const MID_PINNED = makeSession('mid-pinned', 2000);
const NEW_PINNED = makeSession('new-pinned', 3000);
const UNPINNED_A = makeSession('unpinned-a', 4000);
const UNPINNED_B = makeSession('unpinned-b', 5000);

describe('compareSessionsByPinnedAndTime', () => {
  test('pinned session sorts above non-pinned', () => {
    const pinned = new Set(['old-pinned']);
    expect(compareSessionsByPinnedAndTime(OLD_PINNED, UNPINNED_A, pinned)).toBeLessThan(0);
    expect(compareSessionsByPinnedAndTime(UNPINNED_A, OLD_PINNED, pinned)).toBeGreaterThan(0);
  });

  test('two pinned sessions respect pinnedOrder index — earlier entry first', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    const order = ['old-pinned', 'new-pinned']; // old first, new second
    // old-pinned should come before new-pinned
    expect(compareSessionsByPinnedAndTime(OLD_PINNED, NEW_PINNED, pinned, order)).toBeLessThan(0);
    expect(compareSessionsByPinnedAndTime(NEW_PINNED, OLD_PINNED, pinned, order)).toBeGreaterThan(0);
  });

  test('new pin (appended to pinnedOrder end) sorts after existing pins', () => {
    const pinned = new Set(['old-pinned', 'mid-pinned', 'new-pinned']);
    const order = ['old-pinned', 'mid-pinned', 'new-pinned'];
    // new-pinned at index 2 → sorts LAST among pinned
    expect(compareSessionsByPinnedAndTime(NEW_PINNED, OLD_PINNED, pinned, order)).toBeGreaterThan(0);
    expect(compareSessionsByPinnedAndTime(NEW_PINNED, MID_PINNED, pinned, order)).toBeGreaterThan(0);
    // old-pinned at index 0 → sorts FIRST among pinned
    expect(compareSessionsByPinnedAndTime(OLD_PINNED, MID_PINNED, pinned, order)).toBeLessThan(0);
  });

  test('session in pinnedOrder sorts before session NOT in pinnedOrder', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    const order = ['old-pinned']; // new-pinned not in order yet
    // old-pinned (in order) should come before new-pinned (not in order)
    expect(compareSessionsByPinnedAndTime(OLD_PINNED, NEW_PINNED, pinned, order)).toBeLessThan(0);
    expect(compareSessionsByPinnedAndTime(NEW_PINNED, OLD_PINNED, pinned, order)).toBeGreaterThan(0);
  });

  test('empty pinnedOrder falls back to created-desc among pinned', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    // No order array → fallback: getSessionCreatedAt(b) - getSessionCreatedAt(a)
    // new-pinned (3000) > old-pinned (1000) → new-pinned first
    expect(compareSessionsByPinnedAndTime(NEW_PINNED, OLD_PINNED, pinned)).toBeLessThan(0);
    expect(compareSessionsByPinnedAndTime(OLD_PINNED, NEW_PINNED, pinned)).toBeGreaterThan(0);
  });

  test('two non-pinned sessions sort by updated-desc', () => {
    const pinned = new Set<string>();
    // unpinned-b (5000) > unpinned-a (4000) → unpinned-b first
    expect(compareSessionsByPinnedAndTime(UNPINNED_B, UNPINNED_A, pinned)).toBeLessThan(0);
  });
});

describe('compareSessionsByPinnedAndCreated', () => {
  test('pinned session sorts above non-pinned', () => {
    const pinned = new Set(['old-pinned']);
    expect(compareSessionsByPinnedAndCreated(OLD_PINNED, UNPINNED_A, pinned)).toBeLessThan(0);
  });

  test('pinnedOrder index respected — new pin at end sorts last', () => {
    const pinned = new Set(['old-pinned', 'mid-pinned', 'new-pinned']);
    const order = ['old-pinned', 'mid-pinned', 'new-pinned'];
    expect(compareSessionsByPinnedAndCreated(NEW_PINNED, OLD_PINNED, pinned, order)).toBeGreaterThan(0);
    expect(compareSessionsByPinnedAndCreated(NEW_PINNED, MID_PINNED, pinned, order)).toBeGreaterThan(0);
  });

  test('session not in pinnedOrder sorts after session in pinnedOrder', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    const order = ['old-pinned'];
    expect(compareSessionsByPinnedAndCreated(NEW_PINNED, OLD_PINNED, pinned, order)).toBeGreaterThan(0);
  });
});

describe('compareSessions (dispatcher)', () => {
  test('created-desc mode delegates to compareSessionsByPinnedAndCreated', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    const order = ['old-pinned', 'new-pinned'];
    const resultDirect = compareSessionsByPinnedAndCreated(OLD_PINNED, NEW_PINNED, pinned, order);
    const resultDispatched = compareSessions(OLD_PINNED, NEW_PINNED, pinned, 'created-desc', order);
    expect(resultDispatched).toBe(resultDirect);
  });

  test('updated-desc mode delegates to compareSessionsByPinnedAndTime', () => {
    const pinned = new Set(['old-pinned', 'new-pinned']);
    const order = ['old-pinned', 'new-pinned'];
    const resultDirect = compareSessionsByPinnedAndTime(OLD_PINNED, NEW_PINNED, pinned, order);
    const resultDispatched = compareSessions(OLD_PINNED, NEW_PINNED, pinned, 'updated-desc', order);
    expect(resultDispatched).toBe(resultDirect);
  });
});
