import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRemoteInstancesRuntime, normalizeHealthProbeTimeoutSec } from './config.js';

const originalFetch = globalThis.fetch;

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function createRuntimeWithSettings(initialSettings) {
  let settings = structuredClone(initialSettings);
  const runtime = createRemoteInstancesRuntime({
    readSettingsFromDisk: async () => settings,
    writeSettingsToDisk: async (next) => {
      settings = structuredClone(next);
    },
    readSettingsFromDiskMigrated: async () => settings,
    persistSettings: async (patch) => {
      settings = {
        ...settings,
        ...structuredClone(patch),
      };
    },
  });

  return {
    runtime,
    getSettings: () => settings,
  };
}

describe('remote instances runtime config', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('redacts auth secrets from list responses but keeps them internally', async () => {
    const { runtime } = createRuntimeWithSettings({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'bearer', value: 'secret-token' },
        },
      ],
    });

    await runtime.refreshCache();

    const listed = await runtime.getInstances();
    expect(listed[0].auth).toEqual({ type: 'bearer', hasValue: true });

    const internal = await runtime.getInstance('remote-a');
    expect(internal.auth).toEqual({ type: 'bearer', value: 'secret-token' });
  });

  it('preserves existing auth secrets when saves omit the secret value', async () => {
    const { runtime, getSettings } = createRuntimeWithSettings({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'password', value: 'open-sesame' },
        },
      ],
    });

    await runtime.refreshCache();
    await runtime.setInstances([
      {
        id: 'remote-a',
        label: 'Remote A Updated',
        url: 'http://remote-a-updated.example',
        enabled: true,
        auth: { type: 'password', hasValue: true },
      },
    ]);

    expect(getSettings().remoteInstances[0]).toMatchObject({
      id: 'remote-a',
      label: 'Remote A Updated',
      url: 'http://remote-a-updated.example',
      auth: { type: 'password', value: 'open-sesame' },
    });
  });

  it('rejects invalid remote instances instead of silently dropping them', async () => {
    const { runtime, getSettings } = createRuntimeWithSettings({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'none' },
        },
      ],
    });

    await expect(runtime.setInstances([
      {
        id: 'remote-a',
        label: 'Remote A',
        url: '',
        enabled: true,
        auth: { type: 'none' },
      },
    ])).rejects.toMatchObject({ statusCode: 400 });

    expect(getSettings().remoteInstances[0].url).toBe('http://remote-a.example');
  });

  it('caps remote health probe timeout hints to a short fail-fast window', () => {
    expect(normalizeHealthProbeTimeoutSec()).toBe(3);
    expect(normalizeHealthProbeTimeoutSec(30)).toBe(5);
    expect(normalizeHealthProbeTimeoutSec(300)).toBe(5);
    expect(normalizeHealthProbeTimeoutSec(0, 30)).toBe(5);
    expect(normalizeHealthProbeTimeoutSec(2)).toBe(2);
  });

  it('does not trust stale remote health when the OpenCode API probe fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        isOpenCodeReady: true,
        openCodeRunning: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'OpenCode service unavailable' }, 503));
    globalThis.fetch = fetchMock;

    const { runtime } = createRuntimeWithSettings({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'none' },
        },
      ],
    });

    await runtime.refreshCache();
    const instance = await runtime.getInstance('remote-a');
    const status = await runtime.probeHealth(instance, { timeoutSec: 5 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://remote-a.example/health',
      'http://remote-a.example/api/global/health',
    ]);
    expect(status).toMatchObject({
      healthy: false,
      error: 'OpenCode service unavailable',
    });
    expect(runtime.isHealthy('remote-a')).toBe(false);
  });

  it('marks a remote instance healthy only after the OpenCode API probe succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: 'ok',
        isOpenCodeReady: true,
        openCodeRunning: true,
      }))
      .mockResolvedValueOnce(jsonResponse({ healthy: true }));
    globalThis.fetch = fetchMock;

    const { runtime } = createRuntimeWithSettings({
      remoteInstances: [
        {
          id: 'remote-a',
          label: 'Remote A',
          url: 'http://remote-a.example',
          enabled: true,
          auth: { type: 'none' },
        },
      ],
    });

    await runtime.refreshCache();
    const instance = await runtime.getInstance('remote-a');
    const status = await runtime.probeHealth(instance, { timeoutSec: 5 });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://remote-a.example/health',
      'http://remote-a.example/api/global/health',
    ]);
    expect(status).toMatchObject({ healthy: true });
    expect(runtime.isHealthy('remote-a')).toBe(true);
  });

  it('keeps stream lane pressure isolated from normal remote API requests', async () => {
    const { runtime } = createRuntimeWithSettings({ remoteInstances: [] });
    const streamReleases = [];

    for (let index = 0; index < 3; index += 1) {
      streamReleases.push(await runtime.enterRequestLane('remote-a', 'stream'));
    }

    await expect(runtime.enterRequestLane('remote-a', 'stream')).rejects.toMatchObject({
      statusCode: 429,
      code: 'REMOTE_LANE_BUSY',
      retryAfterMs: 1_000,
    });

    const normalRelease = await runtime.enterRequestLane('remote-a', 'normal');
    normalRelease();
    for (const release of streamReleases) {
      release();
    }
  });

  it('queues normal remote API requests briefly and drains them on release', async () => {
    const { runtime } = createRuntimeWithSettings({ remoteInstances: [] });
    const releases = [];

    for (let index = 0; index < 4; index += 1) {
      releases.push(await runtime.enterRequestLane('remote-a', 'normal'));
    }

    const queued = runtime.enterRequestLane('remote-a', 'normal', { queueTimeoutMs: 100 });
    await Promise.resolve();
    expect(runtime.getRequestPressure('remote-a').queued.normal).toBe(1);

    releases.pop()();
    const queuedRelease = await queued;
    queuedRelease();
    for (const release of releases) {
      release();
    }
  });

  it('opens a short circuit after repeated remote transport failures', async () => {
    const { runtime } = createRuntimeWithSettings({ remoteInstances: [] });

    runtime.recordRemoteRequestFailure('remote-a', { status: 504 });
    runtime.recordRemoteRequestFailure('remote-a', { status: 503 });
    runtime.recordRemoteRequestFailure('remote-a', { status: 0 });

    expect(runtime.isRequestCircuitOpen('remote-a')).toBe(true);
    await expect(runtime.enterRequestLane('remote-a', 'normal')).rejects.toMatchObject({
      statusCode: 503,
      code: 'REMOTE_CIRCUIT_OPEN',
      retryAfterMs: expect.any(Number),
    });

    const healthRelease = await runtime.enterRequestLane('remote-a', 'health');
    healthRelease();

    runtime.recordRemoteRequestSuccess('remote-a');
    const normalRelease = await runtime.enterRequestLane('remote-a', 'normal');
    normalRelease();
  });
});
