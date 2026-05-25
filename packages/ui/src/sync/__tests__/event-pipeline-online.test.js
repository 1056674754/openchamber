import { afterEach, describe, expect, it } from 'bun:test';
import { createEventPipeline } from '../event-pipeline';

const savedDocument = globalThis.document;
const savedWindow = globalThis.window;
const savedNavigator = globalThis.navigator;

afterEach(() => {
  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
  globalThis.navigator = savedNavigator;
});

function createEventTarget(extras = {}) {
  const listeners = new Map();
  return {
    ...extras,
    addEventListener(event, handler) {
      const list = listeners.get(event);
      if (list) list.add(handler);
      else listeners.set(event, new Set([handler]));
    },
    removeEventListener(event, handler) {
      listeners.get(event)?.delete(handler);
    },
    dispatch(event) {
      const list = listeners.get(event);
      if (!list) return;
      for (const handler of Array.from(list)) {
        handler();
      }
    },
  };
}

describe('createEventPipeline - online event', () => {
  it('cuts the inter-attempt wait short when online fires after disconnect', async () => {
    globalThis.document = createEventTarget({ visibilityState: 'visible' });
    globalThis.window = createEventTarget({
      location: { href: 'http://127.0.0.1:3000/', origin: 'http://127.0.0.1:3000' },
    });
    globalThis.navigator = { onLine: false };

    let sdkCallIndex = 0;
    const sdk = {
      global: {
        event: async () => {
          const idx = sdkCallIndex++;
          if (idx === 0) {
            throw new Error('simulated network error');
          }
          return {
            stream: (async function* () {
              yield {
                payload: {
                  type: 'session.status',
                  properties: { sessionID: 's1', status: { type: 'idle' } },
                },
              };
              await new Promise(() => {});
            })(),
          };
        },
      },
    };

    const startedAt = Date.now();
    const elapsed = await new Promise((resolve) => {
      let connects = 0;
      const { cleanup } = createEventPipeline({
        sdk,
        transport: 'sse',
        heartbeatTimeoutMs: 60_000,
        reconnectDelayMs: 60_000,
        onEvent: () => {},
        onDisconnect: () => {
          setTimeout(() => {
            globalThis.navigator = { onLine: true };
            globalThis.window.dispatch('online');
          }, 30);
        },
        onReconnect: () => {
          connects += 1;
          if (connects === 1) {
            cleanup();
            resolve(Date.now() - startedAt);
          }
        },
      });
    });

    expect(sdkCallIndex).toBe(2);
    expect(elapsed).toBeLessThan(2_000);
  });
});
