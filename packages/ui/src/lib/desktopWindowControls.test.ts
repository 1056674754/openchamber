import { describe, expect, test } from 'bun:test';

import {
  getDesktopWindowControlsOrder,
  normalizeDesktopWindowControlsPosition,
  resolveDesktopWindowControlsSide,
} from './desktop';

describe('desktop window controls', () => {
  test('uses platform-familiar ordering on each configured side', () => {
    expect(getDesktopWindowControlsOrder('left')).toEqual(['close', 'minimize', 'maximize']);
    expect(getDesktopWindowControlsOrder('right')).toEqual(['minimize', 'maximize', 'close']);
  });

  test('normalizes persisted values without accepting unknown positions', () => {
    expect(normalizeDesktopWindowControlsPosition('left')).toBe('left');
    expect(normalizeDesktopWindowControlsPosition('right')).toBe('right');
    expect(normalizeDesktopWindowControlsPosition('auto')).toBe('right');
    expect(normalizeDesktopWindowControlsPosition('bottom')).toBe(undefined);
  });

  test('defaults controls to the right side', () => {
    expect(resolveDesktopWindowControlsSide(undefined)).toBe('right');
  });
});
