import { describe, expect, test } from 'bun:test';
import { resolveOverlayScrollbarOpacity } from './overlayScrollbarVisibility';

describe('resolveOverlayScrollbarOpacity', () => {
  test('keeps settings scrollbars visible without user activity', () => {
    expect(resolveOverlayScrollbarOpacity({
      alwaysVisible: true,
      suppressVisibility: false,
      visible: false,
    })).toBe(1);
  });

  test('lets suppression override persistent visibility', () => {
    expect(resolveOverlayScrollbarOpacity({
      alwaysVisible: true,
      suppressVisibility: true,
      visible: true,
    })).toBe(0);
  });
});
