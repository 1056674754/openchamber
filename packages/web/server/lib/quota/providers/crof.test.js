import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readOpenCodeCredentials: async () => ({ crof: { key: 'test-token' } }),
}));

import { fetchQuota } from './crof.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('Crof quota provider', () => {
  it('reports the credits balance without inventing a percentage window', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      usable_requests: 450,
      credits: 12.3456,
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('crof');
    expect(result.usage.windows.credits).toMatchObject({
      usedPercent: null,
      windowSeconds: null,
      resetAt: null,
      valueLabel: '$12.35',
    });
  });

  it('preserves a successful response when credits are absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ usable_requests: 0 })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits.usedPercent).toBeNull();
    expect(result.usage.windows.credits.valueLabel).toBeUndefined();
  });

  it('maps an unauthorized response to a re-authentication error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 401)));

    const result = await fetchQuota();

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      error: 'Session expired — please re-authenticate with CrofAI',
    });
  });

  it('reports invalid JSON as a provider response error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));

    const result = await fetchQuota();

    expect(result.error).toBe('Invalid response from provider');
  });
});
