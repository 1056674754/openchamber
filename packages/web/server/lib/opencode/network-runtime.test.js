import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenCodeNetworkRuntime } from './network-runtime.js';

const createRuntime = () => createOpenCodeNetworkRuntime({
  state: {
    openCodePort: 4096,
    openCodeBaseUrl: null,
    openCodeApiPrefix: '',
    openCodeApiPrefixDetected: false,
    openCodeApiDetectionTimer: null,
  },
  getOpenCodeAuthHeaders: () => ({}),
});

describe('OpenCode network runtime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears the probe abort timer when readiness fetch rejects', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));

    const runtime = createRuntime();
    const readyPromise = runtime.waitForReady('http://127.0.0.1:4096', 1);

    await vi.advanceTimersByTimeAsync(100);
    await expect(readyPromise).resolves.toBe(false);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the v1 health contract and records its version without consulting /api/info', async () => {
    const { resetProtocolModes, getStoredProtocolModeEntry } = await import('./protocol-mode.js');
    resetProtocolModes();
    const fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        json: async () => ({ healthy: true, version: '1.18.31' }),
      };
    }));

    const runtime = createRuntime();
    await expect(runtime.waitForReady('http://127.0.0.1:4096', 1000)).resolves.toBe(true);

    expect(fetchCalls).toEqual(['http://127.0.0.1:4096/global/health']);
    expect(getStoredProtocolModeEntry('default')?.mode).toBe('v1');
    expect(getStoredProtocolModeEntry('default')?.version).toBe('1.18.31');
    resetProtocolModes();
  });

  it('falls back to /api/info when the v1 health probe fails and records the v2 version', async () => {
    const { resetProtocolModes, getStoredProtocolModeEntry } = await import('./protocol-mode.js');
    resetProtocolModes();
    const fetchCalls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes('/global/health')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({ version: '2.0.14', pid: 7, urls: [], paths: { tmp: '/tmp' } }),
      };
    }));

    const runtime = createRuntime();
    await expect(runtime.waitForReady('http://127.0.0.1:4096', 1000)).resolves.toBe(true);

    expect(fetchCalls).toEqual([
      'http://127.0.0.1:4096/global/health',
      'http://127.0.0.1:4096/api/info',
    ]);
    expect(getStoredProtocolModeEntry('default')?.mode).toBe('v2');
    expect(getStoredProtocolModeEntry('default')?.version).toBe('2.0.14');
    resetProtocolModes();
  });
});
