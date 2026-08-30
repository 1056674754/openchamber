import { describe, expect, it, vi } from 'vitest';

import { createRemoteOpenChamberEventFanout } from './openchamber-event-fanout.js';

describe('remote OpenChamber event fanout', () => {
  it('uses a browser-capable synthetic event stream and preserves server identity', async () => {
    let readerOptions = null;
    const stop = vi.fn();
    const releaseLane = vi.fn();
    const received = [];
    const runtime = {
      getInstances: vi.fn(async () => [{ id: 'remote-a' }]),
      getInstanceSync: vi.fn(() => ({ id: 'remote-a', url: 'https://remote.example/', enabled: true, auth: { type: 'none' } })),
      isHealthy: vi.fn(() => true),
      enterRequestLane: vi.fn(async () => releaseLane),
      recordRemoteRequestSuccess: vi.fn(),
      recordRemoteRequestFailure: vi.fn(),
    };
    const fanout = createRemoteOpenChamberEventFanout({
      remoteInstancesRuntime: runtime,
      createReader: (options) => {
        readerOptions = options;
        return { start: async () => new Promise(() => {}), stop };
      },
    });

    const unsubscribe = fanout.subscribe((event) => received.push(event));
    await vi.waitFor(() => expect(readerOptions).not.toBeNull());

    expect(readerOptions.buildUrl().toString()).toBe('https://remote.example/api/openchamber/events?browser=1');
    readerOptions.onEvent({ payload: { type: 'openchamber:browser-control-request' } });
    expect(received).toEqual([{
      serverId: 'remote-a',
      payload: { type: 'openchamber:browser-control-request' },
    }]);

    unsubscribe();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(releaseLane).toHaveBeenCalledTimes(1);
  });

  it('treats a missing optional endpoint as unsupported without degrading remote health', async () => {
    let readerOptions = null;
    const stop = vi.fn();
    const releaseLane = vi.fn();
    const runtime = {
      getInstances: vi.fn(async () => [{ id: 'legacy' }]),
      getInstanceSync: vi.fn(() => ({ id: 'legacy', url: 'https://legacy.example', enabled: true })),
      isHealthy: vi.fn(() => true),
      enterRequestLane: vi.fn(async () => releaseLane),
      recordRemoteRequestFailure: vi.fn(),
    };
    const fanout = createRemoteOpenChamberEventFanout({
      remoteInstancesRuntime: runtime,
      createReader: (options) => {
        readerOptions = options;
        return { start: async () => new Promise(() => {}), stop };
      },
    });
    const unsubscribe = fanout.subscribe(() => {});
    await vi.waitFor(() => expect(readerOptions).not.toBeNull());

    readerOptions.onError({ type: 'upstream_unavailable', status: 404 });

    expect(runtime.recordRemoteRequestFailure).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(releaseLane).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
