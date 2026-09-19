import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('VS Code webview bridge API fallback', () => {
  test('announces the document before its first outbound message', async () => {
    const originalWindow = globalThis.window;
    const originalAcquire = (globalThis as typeof globalThis & { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    const messages: unknown[] = [];

    try {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: new EventTarget(),
      });
      Object.defineProperty(globalThis, 'acquireVsCodeApi', {
        configurable: true,
        value: () => ({
          postMessage: (message: unknown) => { messages.push(message); },
          getState: () => undefined,
          setState: () => undefined,
        }),
      });

      const { startSseProxy } = await import(`./bridge?announce-${Date.now()}`);
      const startPromise = startSseProxy({ path: '/global/event' });
      // The announce arrives before any request; the host retires the previous
      // document's streams when it sees it.
      assert.deepEqual(messages[0], { id: 'bridge-ready', type: 'webview:bridgeReady', success: true });
      const request = messages[1] as { id: string; type: string };
      assert.equal(request.type, 'api:sse:start');
      globalThis.window.dispatchEvent(new MessageEvent('message', {
        data: {
          id: request.id,
          type: 'api:sse:start',
          success: true,
          data: { status: 200, headers: {}, streamId: 'sse_webview_1_1' },
        },
      }));
      assert.equal((await startPromise).streamId, 'sse_webview_1_1');
      assert.equal(messages.length, 2);
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'acquireVsCodeApi', { configurable: true, value: originalAcquire });
    }
  });

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
