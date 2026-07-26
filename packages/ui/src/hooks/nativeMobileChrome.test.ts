import { describe, expect, test } from 'bun:test';

import {
  applyCapacitorRootClass,
  CAPACITOR_ROOT_CLASS,
  clampKeyboardInsetPx,
  formatKeyboardInset,
  KEYBOARD_INSET_CSS_VAR,
  setKeyboardInsetCssVar,
} from './nativeMobileChrome';

describe('nativeMobileChrome helpers', () => {
  test('clamps non-positive keyboard heights to 0', () => {
    expect(clampKeyboardInsetPx(-10)).toBe(0);
    expect(clampKeyboardInsetPx(Number.NaN)).toBe(0);
    expect(clampKeyboardInsetPx(312.7)).toBe(313);
  });

  test('writes the keyboard inset CSS variable', () => {
    const props = new Map<string, string>();
    setKeyboardInsetCssVar(
      { style: { setProperty: (name, value) => { props.set(name, value); } } },
      280,
    );
    expect(props.get(KEYBOARD_INSET_CSS_VAR)).toBe(formatKeyboardInset(280));
  });

  test('toggles the capacitor root class', () => {
    const classes = new Set<string>();
    const root = {
      classList: {
        add: (value: string) => { classes.add(value); },
        remove: (value: string) => { classes.delete(value); },
      },
    };
    applyCapacitorRootClass(root, true);
    expect(classes.has(CAPACITOR_ROOT_CLASS)).toBe(true);
    applyCapacitorRootClass(root, false);
    expect(classes.has(CAPACITOR_ROOT_CLASS)).toBe(false);
  });
});
