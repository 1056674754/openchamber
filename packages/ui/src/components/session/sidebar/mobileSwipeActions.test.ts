import { describe, expect, test } from 'bun:test';

import {
  clampMobileSwipeOffset,
  shouldRevealMobileSwipeActions,
} from './mobileSwipeActions';

describe('mobile session swipe actions', () => {
  test('clamps the row between closed and fully revealed', () => {
    expect(clampMobileSwipeOffset(40, 144)).toBe(0);
    expect(clampMobileSwipeOffset(-200, 144)).toBe(-144);
    expect(clampMobileSwipeOffset(-60, 144)).toBe(-60);
  });

  test('reveals only after crossing half the action width', () => {
    expect(shouldRevealMobileSwipeActions(-71, 144)).toBe(false);
    expect(shouldRevealMobileSwipeActions(-73, 144)).toBe(true);
  });
});
