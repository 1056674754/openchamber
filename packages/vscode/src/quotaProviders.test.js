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
        neuralwatt: { key: 'test-token' },
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
