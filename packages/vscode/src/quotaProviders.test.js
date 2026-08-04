import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('node:fs', () => ({
  default: {
    existsSync: (filePath) => filePath.endsWith('/auth.json'),
    readFileSync: (filePath) => {
      if (!filePath.endsWith('/auth.json')) {
        throw new Error(`Unexpected fixture read: ${filePath}`);
      }
      return JSON.stringify({
        crof: { key: 'test-token' },
        deepseek: { key: 'test-token' },
        kimi: { key: 'test-token' },
        neuralwatt: { key: 'test-token' },
        'zai-coding-plan': { key: 'test-token' },
      });
    },
  },
}));

const {
  fetchQuotaForProvider,
  listConfiguredQuotaProviders,
} = await import('./quotaProviders.ts');

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const response = (body, status = 200) => new Response(
  JSON.stringify(body),
  {
    status,
    headers: { 'Content-Type': 'application/json' },
  },
);

describe('VS Code quota provider parity', () => {
  it('discovers Crof and NeuralWatt from the extension host auth file', () => {
    expect(listConfiguredQuotaProviders()).toEqual(expect.arrayContaining([
      'crof',
      'deepseek',
      'kimi-for-coding',
      'neuralwatt',
    ]));
  });

  it('reports Crof credits without a fabricated percentage', async () => {
    globalThis.fetch = mock(async () => response({
      usable_requests: 450,
      credits: 12.3456,
    }));

    const result = await fetchQuotaForProvider('crof');

    expect(result.ok).toBe(true);
    expect(result.usage?.windows.credits).toMatchObject({
      usedPercent: null,
      valueLabel: '$12.35',
    });
  });

  it('reports NeuralWatt subscription and key allowance independently', async () => {
    globalThis.fetch = mock(async () => response({
      balance: { credits_remaining_usd: 30 },
      subscription: {
        plan: 'standard',
        kwh_included: 20,
        kwh_used: 10,
        current_period_end: '2027-04-11T05:05:25Z',
        in_overage: false,
      },
      key: {
        name: 'prod-key',
        allowance: {
          limit_usd: 100,
          spent_usd: 25,
          period: 'monthly',
          reset_at: '2026-08-01T00:00:00Z',
          blocked: false,
        },
      },
    }));

    const result = await fetchQuotaForProvider('neuralwatt');

    expect(result.ok).toBe(true);
    expect(result.usage?.windows.standard.usedPercent).toBe(50);
    expect(result.usage?.windows.monthly.usedPercent).toBeCloseTo((25 / 55) * 100, 4);
    expect(result.usage?.windows.monthly.valueLabel).toBe('prod-key');
  });

  it('reports every Z.ai usage window', async () => {
    globalThis.fetch = mock(async () => response({
      data: {
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 0 },
          { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 100, nextResetTime: 1785659659993 },
          { type: 'TIME_LIMIT', unit: 5, number: 1, percentage: 0, nextResetTime: 1787128459979 },
        ],
      },
    }));

    const result = await fetchQuotaForProvider('zai-coding-plan');

    expect(result.ok).toBe(true);
    expect(result.usage?.windows['5h']).toMatchObject({ usedPercent: 0, windowSeconds: 5 * 60 * 60 });
    expect(result.usage?.windows.weekly).toMatchObject({
      usedPercent: 100,
      windowSeconds: 7 * 24 * 60 * 60,
      resetAt: 1785659659993,
    });
    expect(result.usage?.windows['MCP Tools']).toMatchObject({
      usedPercent: 0,
      windowSeconds: 30 * 24 * 60 * 60,
      resetAt: 1787128459979,
    });
  });

  it('uses Kimi used values before remaining and falls back when used is absent', async () => {
    globalThis.fetch = mock(async () => response({
      usage: { limit: 100, used: 25, remaining: 1 },
      limits: [{
        window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
        detail: { limit: 200, remaining: 50 },
      }],
    }));

    const result = await fetchQuotaForProvider('kimi-for-coding');

    expect(result.usage?.windows.weekly.usedPercent).toBe(25);
    expect(result.usage?.windows['Rate Limit (5h)'].usedPercent).toBe(75);
  });

  it('reports DeepSeek account balance as a label-only window', async () => {
    globalThis.fetch = mock(async () => response({
      balance_infos: [
        { currency: 'CNY', total_balance: '100.00' },
        { currency: 'USD', total_balance: '7.54' },
      ],
    }));

    const result = await fetchQuotaForProvider('deepseek');

    expect(result.ok).toBe(true);
    expect(result.usage?.windows.credits_balance).toMatchObject({
      usedPercent: null,
      valueLabel: '$7.54',
    });
  });

  it('keeps provider-specific authentication errors in the extension host', async () => {
    globalThis.fetch = mock(async () => response({}, 401));

    await expect(fetchQuotaForProvider('crof')).resolves.toMatchObject({
      ok: false,
      configured: true,
      error: 'Session expired — please re-authenticate with CrofAI',
    });
    await expect(fetchQuotaForProvider('neuralwatt')).resolves.toMatchObject({
      ok: false,
      configured: true,
      error: 'Session expired — please re-authenticate with NeuralWatt',
    });
  });
});
