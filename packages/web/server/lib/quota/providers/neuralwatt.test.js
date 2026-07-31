import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: () => ({ neuralwatt: { key: 'test-token' } }),
}));

import { fetchQuota } from './neuralwatt.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const subscriptionPayload = {
  balance: { credits_remaining_usd: 32.6774 },
  subscription: {
    plan: 'standard',
    current_period_end: '2027-04-11T05:05:25Z',
    kwh_included: 20,
    kwh_used: 13.9023,
    in_overage: false,
  },
  key: { name: 'my-production-key', allowance: null },
};

describe('NeuralWatt quota provider', () => {
  it('reports subscription kWh and credits as independent windows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(subscriptionPayload)));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.providerId).toBe('neuralwatt');
    expect(result.usage.windows.standard.usedPercent).toBeCloseTo((13.9023 / 20) * 100, 4);
    expect(result.usage.windows.standard.windowSeconds).toBeNull();
    expect(result.usage.windows.standard.resetAt).toBe(Date.parse('2027-04-11T05:05:25Z'));
    expect(result.usage.windows.credits_balance.valueLabel).toBe('$32.68');
  });

  it('uses the lower of allowance limit and funded credits as its ceiling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      balance: { credits_remaining_usd: 30 },
      subscription: null,
      key: {
        name: 'prod-key',
        allowance: {
          limit_usd: 100,
          period: 'monthly',
          spent_usd: 25,
          blocked: false,
          reset_at: '2026-08-01T00:00:00Z',
        },
      },
    })));

    const result = await fetchQuota();

    expect(result.usage.windows.monthly.usedPercent).toBeCloseTo((25 / 55) * 100, 4);
    expect(result.usage.windows.monthly.windowSeconds).toBe(30 * 86400);
    expect(result.usage.windows.monthly.valueLabel).toBe('prod-key');
    expect(result.usage.windows.credits_balance).toBeUndefined();
  });

  it('marks blocked allowances and subscription overage as fully used', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      balance: { credits_remaining_usd: 30 },
      subscription: {
        plan: 'standard',
        kwh_included: 20,
        kwh_used: 25,
        in_overage: true,
      },
      key: {
        name: 'blocked-key',
        allowance: {
          limit_usd: 50,
          period: 'weekly',
          spent_usd: 10,
          blocked: true,
        },
      },
    })));

    const result = await fetchQuota();

    expect(result.usage.windows.standard.usedPercent).toBe(100);
    expect(result.usage.windows.weekly.usedPercent).toBe(100);
  });

  it('rejects successful payloads with no usable quota data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({
      balance: { credits_remaining_usd: null },
      subscription: null,
      key: { name: 'sample', allowance: null },
    })));

    const result = await fetchQuota();

    expect(result).toMatchObject({
      ok: false,
      configured: true,
      usage: null,
      error: 'No quota data in response',
    });
  });

  it('maps unauthorized and invalid JSON responses to stable errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, 401)));
    await expect(fetchQuota()).resolves.toMatchObject({
      ok: false,
      error: 'Session expired — please re-authenticate with NeuralWatt',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }));
    await expect(fetchQuota()).resolves.toMatchObject({
      ok: false,
      error: 'Invalid response from provider',
    });
  });
});
