import { describe, expect, test } from 'bun:test';

import { getClientPlatform, isCapacitorApp, isNativeShellApp, isOhosApp } from './platform';

const withWindow = <T>(value: Record<string, unknown> | undefined, callback: () => T): T => {
  const originalWindow = globalThis.window;
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: value ? { location: { protocol: 'http:' }, ...value } : undefined,
    });
    return callback();
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  }
};

describe('platform detection', () => {
  test('isOhosApp requires the injected ohos global', () => {
    withWindow({ __OPENCHAMBER_OHOS__: true }, () => {
      expect(isOhosApp()).toBe(true);
      expect(isNativeShellApp()).toBe(true);
      expect(isCapacitorApp()).toBe(false);
      expect(getClientPlatform()).toBe('ohos');
    });
  });

  test('ohos global false is not a shell', () => {
    withWindow({ __OPENCHAMBER_OHOS__: false }, () => {
      expect(isOhosApp()).toBe(false);
      expect(isNativeShellApp()).toBe(false);
      // Not asserting the 'web' fallback here: other suites mock.module
      // '@/lib/desktop' process-wide, which would skew the desktop/vscode
      // fallbacks under this window. The ohos/capacitor discrimination above
      // is window-driven and immune to that.
      expect(getClientPlatform()).not.toBe('ohos');
    });
  });

  test('the shell virtual origin identifies the ohos shell', () => {
    withWindow({ location: { protocol: 'http:', host: 'app.openchamber.localhost' } }, () => {
      expect(isOhosApp()).toBe(true);
      expect(isNativeShellApp()).toBe(true);
      expect(getClientPlatform()).toBe('ohos');
    });
  });

  test('the legacy virtual origin spelling also identifies the ohos shell', () => {
    withWindow({ location: { protocol: 'https:', host: 'app.openchamber.local' } }, () => {
      expect(isOhosApp()).toBe(true);
      expect(isNativeShellApp()).toBe(true);
      expect(getClientPlatform()).toBe('ohos');
    });
  });

  test('capacitor native platform wins over the ohos global', () => {
    withWindow({
      __OPENCHAMBER_OHOS__: true,
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    }, () => {
      expect(isCapacitorApp()).toBe(true);
      expect(isOhosApp()).toBe(true);
      expect(isNativeShellApp()).toBe(true);
      expect(getClientPlatform()).toBe('android');
    });
  });

  test('no window means no shell', () => {
    withWindow(undefined, () => {
      expect(isOhosApp()).toBe(false);
      expect(isCapacitorApp()).toBe(false);
      expect(isNativeShellApp()).toBe(false);
    });
  });
});
