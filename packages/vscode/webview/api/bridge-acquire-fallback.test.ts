import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('VS Code webview bridge API fallback', () => {
  test('times out normally when acquireVsCodeApi returns undefined', async () => {
    const originalWindow = globalThis.window;
    const originalAcquire = (globalThis as typeof globalThis & { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];

    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: new EventTarget(),
      });
      Object.defineProperty(globalThis, 'acquireVsCodeApi', {
        configurable: true,
        value: () => undefined,
      });
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };

      const { sendBridgeMessageWithOptions } = await import(`./bridge?fallback-${Date.now()}`);
      const result = await sendBridgeMessageWithOptions(
        'api:proxy',
        { path: '/health' },
        { timeoutMs: 20 },
      ).then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );

      assert.ok(result instanceof Error);
      assert.notEqual(result.name, 'TypeError');
      assert.match(result.message, /timed out/i);
      assert.ok(
        warnings.some((entry) => String(entry[0] ?? '').includes('VS Code API unavailable')),
      );
    } finally {
      console.warn = originalWarn;
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
      Object.defineProperty(globalThis, 'acquireVsCodeApi', {
        configurable: true,
        value: originalAcquire,
      });
    }
  });
});
