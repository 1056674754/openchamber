import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readOpenCodeCredentials: async () => ({ deepseek: { key: 'test-token' } })
}));

import { fetchQuota } from './deepseek.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockResponse = (body, init = {}) => ({
  ok: true,
  status: 200,
  json: async () => body,
  ...init
});

describe('DeepSeek quota provider', () => {
  it('prefers USD and preserves string or zero balances', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00' },
        { currency: 'USD', total_balance: '0.00' }
      ]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('deepseek');
    expect(result.usage.windows.credits_balance).toMatchObject({
      usedPercent: null,
      valueLabel: '$0.00'
    });
  });

  it('falls back to CNY when USD is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({
      balance_infos: [{ currency: 'CNY', total_balance: 12.5 }]
    })));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.credits_balance.valueLabel).toBe('¥12.50');
  });

  it('reports auth and malformed response failures explicitly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchQuota()).resolves.toMatchObject({
      ok: false,
      error: 'Session expired — please re-authenticate with DeepSeek'
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ balance_infos: [] })));
    await expect(fetchQuota()).resolves.toMatchObject({
      ok: false,
      error: 'No quota data in response'
    });
  });
});
