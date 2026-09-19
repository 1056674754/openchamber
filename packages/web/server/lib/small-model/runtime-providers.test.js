import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ZEN_ANONYMOUS_API_KEY,
  configureOpenCodeRuntimeProviders,
  getRuntimeProvider,
  getRuntimeProviderSnapshot,
  resetOpenCodeRuntimeProviders,
} from './runtime-providers.js';

const payload = () => ({
  all: [
    { id: 'plugin', source: 'config', options: { apiKey: 'plugin-key', baseURL: 'https://plugin.test/v1/' }, models: {} },
    { id: 'opencode', options: { apiKey: ZEN_ANONYMOUS_API_KEY }, models: { free: { api: { url: 'https://opencode.ai/zen/v1' } } } },
    { id: 'fallback', key: 'fallback-key', options: {}, models: { m: { api: { url: 'https://fallback.test/v1' } } } },
  ],
  connected: ['plugin', 'opencode', 'fallback'],
});

describe('OpenCode runtime providers', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = vi.fn(async () => Response.json(payload()));
    vi.stubGlobal('fetch', fetchMock);
    configureOpenCodeRuntimeProviders({
      buildOpenCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getOpenCodeAuthHeaders: () => ({ Authorization: 'Basic test' }),
    });
  });
  afterEach(() => {
    configureOpenCodeRuntimeProviders(null);
    resetOpenCodeRuntimeProviders();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns plugin credentials and normalized endpoints', async () => {
    await expect(getRuntimeProvider('plugin')).resolves.toMatchObject({ apiKey: 'plugin-key', baseURL: 'https://plugin.test/v1' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Basic test');
  });

  it('parses per-model endpoints and wire adapters into a models map', async () => {
    const provider = await getRuntimeProvider('opencode');
    expect(provider.models.get('free')).toEqual({
      api: { url: 'https://opencode.ai/zen/v1', npm: null },
    });
    expect(provider.baseURL).toBe('https://opencode.ai/zen/v1');
  });

  it('refuses the anonymous Zen sentinel and uses model endpoint fallback', async () => {
    await expect(getRuntimeProvider('opencode')).resolves.toMatchObject({ apiKey: null, anonymousZen: true });
    await expect(getRuntimeProvider('fallback')).resolves.toMatchObject({ baseURL: 'https://fallback.test/v1' });
  });

  it('coalesces concurrent reads and preserves last-known-good on failure', async () => {
    await Promise.all([getRuntimeProvider('plugin'), getRuntimeProvider('fallback')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_000);
    expect((await getRuntimeProviderSnapshot()).providers.has('plugin')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns unknown while detached instead of an empty provider set', async () => {
    configureOpenCodeRuntimeProviders(null);
    expect(await getRuntimeProviderSnapshot()).toBeNull();
  });
});
