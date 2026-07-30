import { describe, expect, test } from 'bun:test';
import {
  clearStuckProjectHeaders,
  updateStuckProjectHeaders,
} from './useStickyProjectHeaders';

describe('sticky project header state', () => {
  test('preserves the set reference when the observed state does not change', () => {
    const empty = new Set();
    const stuck = new Set(['project-a']);

    expect(updateStuckProjectHeaders(empty, 'project-a', false)).toBe(empty);
    expect(updateStuckProjectHeaders(stuck, 'project-a', true)).toBe(stuck);
    expect(clearStuckProjectHeaders(empty)).toBe(empty);
  });

  test('adds and removes project headers without mutating the previous set', () => {
    const empty = new Set();
    const stuck = updateStuckProjectHeaders(empty, 'project-a', true);
    const unstuck = updateStuckProjectHeaders(stuck, 'project-a', false);

    expect(stuck).not.toBe(empty);
    expect(stuck).toEqual(new Set(['project-a']));
    expect(empty.size).toBe(0);
    expect(unstuck).not.toBe(stuck);
    expect(unstuck.size).toBe(0);
    expect(stuck).toEqual(new Set(['project-a']));
  });

  test('clears stale sticky state without mutating the previous set', () => {
    const stuck = new Set(['project-a', 'project-b']);
    const cleared = clearStuckProjectHeaders(stuck);

    expect(cleared).not.toBe(stuck);
    expect(cleared.size).toBe(0);
    expect(stuck).toEqual(new Set(['project-a', 'project-b']));
  });
});
