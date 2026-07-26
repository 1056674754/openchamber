/** CSS variable driven by Capacitor Keyboard events (see useNativeMobileChrome). */
export const KEYBOARD_INSET_CSS_VAR = '--oc-keyboard-inset';

export const CAPACITOR_ROOT_CLASS = 'capacitor';

export function clampKeyboardInsetPx(height: number): number {
  if (!Number.isFinite(height) || height <= 0) return 0;
  return Math.round(height);
}

export function formatKeyboardInset(heightPx: number): string {
  return `${clampKeyboardInsetPx(heightPx)}px`;
}

export function setKeyboardInsetCssVar(
  root: { style: { setProperty: (name: string, value: string) => void } },
  heightPx: number,
): void {
  root.style.setProperty(KEYBOARD_INSET_CSS_VAR, formatKeyboardInset(heightPx));
}

export function applyCapacitorRootClass(
  root: { classList: { add: (value: string) => void; remove: (value: string) => void } },
  enabled: boolean,
): void {
  if (enabled) {
    root.classList.add(CAPACITOR_ROOT_CLASS);
  } else {
    root.classList.remove(CAPACITOR_ROOT_CLASS);
  }
}
