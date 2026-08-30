import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createGlobalMessageStreamWsBridge } from './global-ws-bridge.js';

class FakeSocket extends EventEmitter {
  constructor(browserCapable) {
    super();
    this.readyState = 1;
    this.openchamberBrowserCapable = browserCapable;
    this.sent = [];
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  ping() {}

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

describe('global Browser event fanout', () => {
  it('subscribes only while a capable browser client exists and preserves remote serverId', () => {
    let emitRemote = null;
    const unsubscribeRemote = vi.fn();
    const remoteFanout = {
      subscribe: vi.fn((listener) => {
        emitRemote = listener;
        return unsubscribeRemote;
      }),
      close: vi.fn(),
    };
    const globalHub = {
      subscribeEvent: () => () => {},
      subscribeStatus: () => () => {},
      replayFrom: () => ({ events: [], gap: false }),
      isConnected: () => true,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const wsClients = new Set();
    const bridge = createGlobalMessageStreamWsBridge({
      globalHub,
      ownsGlobalHub: false,
      wsClients,
      processForwardedEventPayload() {},
      triggerHealthCheck() {},
      heartbeatIntervalMs: 60_000,
      remoteOpenChamberEventFanout: remoteFanout,
    });
    const ordinary = new FakeSocket(false);
    const browser = new FakeSocket(true);

    bridge.accept(ordinary);
    expect(remoteFanout.subscribe).not.toHaveBeenCalled();
    bridge.accept(browser);
    expect(remoteFanout.subscribe).toHaveBeenCalledTimes(1);

    emitRemote({
      serverId: 'remote-a',
      payload: { type: 'openchamber:browser-control-request', properties: { requestId: 'req-1' } },
    });
    expect(ordinary.sent.some((frame) => frame.payload?.properties?.requestId === 'req-1')).toBe(false);
    expect(browser.sent).toContainEqual({
      type: 'event',
      payload: { type: 'openchamber:browser-control-request', properties: { requestId: 'req-1' } },
      serverId: 'remote-a',
      directory: 'global',
    });

    browser.close();
    expect(unsubscribeRemote).toHaveBeenCalledTimes(1);
    ordinary.close();
    bridge.close();
  });
});
