import { describe, expect, test } from 'bun:test';

import {
  resolveLeftDrawerOpen,
  shouldCloseDrawerAfterSessionPick,
} from './mobileLeftDrawerSync';

describe('mobileLeftDrawerSync', () => {
  test('follows the session switcher flag into drawer open state', () => {
    expect(resolveLeftDrawerOpen(true, false)).toBe(false);
    expect(resolveLeftDrawerOpen(false, true)).toBe(true);
  });

  test('closes the drawer after a session pick clears the switcher', () => {
    expect(shouldCloseDrawerAfterSessionPick(true, false)).toBe(true);
    expect(shouldCloseDrawerAfterSessionPick(true, true)).toBe(false);
    expect(shouldCloseDrawerAfterSessionPick(false, false)).toBe(false);
  });
});
