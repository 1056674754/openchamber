import { afterEach, describe, expect, it, mock } from 'bun:test';

mock.module('node:child_process', () => ({
  execFileSync: () => { throw new Error('No Keychain fixture'); },
}));

mock.module('node:fs', () => ({
  default: {
    existsSync: (filePath) => filePath.endsWith('/auth.json') || filePath.endsWith('/.claude/.credentials.json'),
    readFileSync: (filePath) => {
      if (filePath.endsWith('/.claude/.credentials.json')) {
        return JSON.stringify({
          claudeAiOauth: {
            accessToken: 'claude-code-token',
            refreshToken: 'claude-code-refresh',
            subscriptionType: 'max',
          },
        });
      }
      if (!filePath.endsWith('/auth.json')) {
        throw new Error(`Unexpected fixture read: ${filePath}`);
      }
      return JSON.stringify({
        crof: { key: 'test-token' },
        deepseek: { key: 'test-token' },
        kimi: { key: 'test-token' },
        neuralwatt: { key: 'test-token' },
        'zai-coding-plan': { key: 'test-token' },
        'command-code': { key: 'command-token' },
        'opencode-go': { key: 'go-token' },
      });
    },
    unlinkSync: () => undefined,
  },
}));

const {
  fetchOllamaCloudQuota,
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
      'command-code',
      'opencode-go',
      'claude',
    ]));
  });

  it('reads Claude Code credentials, plan limits, and model-scoped usage', async () => {
    globalThis.fetch = mock(async () => response({
      limits: [
        { kind: 'session', percent: 11, resets_at: '2026-08-30T12:00:00Z' },
        { kind: 'weekly_scoped', percent: 22, resets_at: '2026-09-01T12:00:00Z', scope: { model: { display_name: 'Fable' } } },
      ],
    }));

    const result = await fetchQuotaForProvider('claude');

    expect(result).toMatchObject({ ok: true, configured: true, planLabel: 'max' });
    expect(result.usage?.windows['5h']).toMatchObject({ usedPercent: 11, windowSeconds: 5 * 60 * 60 });
    expect(result.usage?.models?.Fable.windows['7d'].usedPercent).toBe(22);
  });

  it('coalesces simultaneous provider refreshes', async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls += 1;
      await Promise.resolve();
      return response({ organization: { id: 'org-test' }, credits: { balance: 10 } });
    });
    const first = fetchQuotaForProvider('command-code');
    const second = fetchQuotaForProvider('command-code');
    expect(first).toBe(second);
    await first;
    expect(calls).toBe(2);
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

  it('reports Z.ai credit limits and plan level', async () => {
    globalThis.fetch = mock(async () => response({
      data: {
        limits: [
          { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 12000, currentValue: 65, percentage: 1 },
          { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 60000, currentValue: 65, percentage: 1 },
        ],
        level: 'pro',
      },
    }));

    const result = await fetchQuotaForProvider('zai-coding-plan');

    expect(result.planLabel).toBe('pro');
    expect(result.usage?.windows['5h'].valueLabel).toBe('65 / 12k credits');
    expect(result.usage?.windows.weekly.valueLabel).toBe('65 / 60k credits');
  });

  it('reports Command Code credits and rolling limits', async () => {
    globalThis.fetch = mock(async (input) => {
      const url = String(input);
      if (url.endsWith('/alpha/whoami')) return response({ org: { id: 'org-1' } });
      return response({
        credits: { monthlyCredits: 80, purchasedCredits: 12.5, freeCredits: 3 },
        windowLimits: {
          fiveHour: { used: 20, cap: 100, resetAt: 1785659659 },
          weekly: { used: 40, cap: 200, resetAt: 1787128459 },
        },
      });
    });

    const result = await fetchQuotaForProvider('command-code');

    expect(result.ok).toBe(true);
    expect(result.usage?.windows.monthly_credits.valueLabel).toBe('80');
    expect(result.usage?.windows['5h']).toMatchObject({ usedPercent: 20, valueLabel: '20 / 100' });
    expect(result.usage?.windows.weekly).toMatchObject({ usedPercent: 20, valueLabel: '40 / 200' });
  });

  it('uses the OpenCode Go API key and JSON usage endpoint', async () => {
    let authorization = '';
    globalThis.fetch = mock(async (_input, init) => {
      authorization = String(init?.headers?.Authorization ?? '');
      return response({
        usage: {
          rolling: { percent: 12, resetsAt: '2026-08-30T12:00:00Z' },
          weekly: { percent: 34, resetsAt: '2026-09-01T12:00:00Z' },
        },
      });
    });

    const result = await fetchQuotaForProvider('opencode-go');

    expect(result.ok).toBe(true);
    expect(authorization).toBe('Bearer go-token');
    expect(result.usage?.windows['5h'].usedPercent).toBe(12);
    expect(result.usage?.windows.weekly.usedPercent).toBe(34);
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

describe('Ollama Cloud quota validation and refresh', () => {
  const readCookie = () => 'test-ollama-cookie';

  for (const { html, expected } of [
    { html: '<h1>Monthly usage</h1><p>$25.00 of $100.00</p>', expected: { monthly: { usedPercent: 25, valueLabel: '$25.00 / $100.00' } } },
    { html: 'Monthly usage $1,250.00 of $2,500.00', expected: { monthly: { usedPercent: 50, valueLabel: '$1,250.00 / $2,500.00' } } },
    { html: 'Session usage 12% Weekly usage 34% Premium 2 / 10', expected: { session: { usedPercent: 12 }, weekly: { usedPercent: 34 }, premium: { usedPercent: 20, valueLabel: '2 / 10' } } },
    { html: 'Monthly usage $0 of $100 Balance remaining $5.25 Add $5', expected: { monthly: { usedPercent: 0, valueLabel: '$0 / $100' }, credits_balance: { usedPercent: null, valueLabel: '$5.25' } } },
    { html: 'Monthly usage $0 of $100 Balance remaining $0.00 Add $5', expected: { monthly: { usedPercent: 0, valueLabel: '$0 / $100' } } },
    { html: 'Monthly usage $125 of $100 Add $5', expected: { monthly: { usedPercent: 100, valueLabel: '$125 / $100' } } },
  ]) {
    it(`accepts and displays ${html}`, async () => {
      const fetchImpl = async (url, init) => {
        expect(url).toBe('https://ollama.com/settings');
        expect(init.redirect).toBe('manual');
        expect(init.method).toBe('GET');
        expect(new Headers(init.headers).get('Cookie')).toBe('test-ollama-cookie');
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(html);
      };
      const result = await fetchOllamaCloudQuota({ readCookie, fetchImpl });
      expect(result.ok).toBe(true);
      expect(result.usage).toBeTruthy();
      expect(Object.keys(result.usage.windows)).toEqual(Object.keys(expected));
      for (const [key, expectedWindow] of Object.entries(expected)) {
        const window = result.usage.windows[key];
        expect(window).toBeTruthy();
        expect(window.usedPercent).toBe(expectedWindow.usedPercent);
        if ('valueLabel' in expectedWindow) expect(window.valueLabel).toBe(expectedWindow.valueLabel);
        expect(window.resetAt).toBe(null);
      }
      expect(JSON.stringify(result)).not.toContain('test-ollama-cookie');
    });
  }

  for (const html of ['', '<h1>Monthly usage</h1>', 'Session usage', 'Session usage 1.2.3%', 'Weekly usage 1.2.3%', 'Add $5', 'Monthly usage $1.2.3 of $100', 'Balance remaining $1.2.3']) {
    it(`rejects unparseable HTML ${JSON.stringify(html)}`, async () => {
      const fetchImpl = async () => new Response(html);
      const result = await fetchOllamaCloudQuota({ readCookie, fetchImpl });
      expect(result.ok).toBe(false);
      expect(result.configured).toBe(true);
      expect(result.usage).toBe(null);
      expect(result.error).toBe('Ollama Cloud usage data could not be parsed');
    });
  }

  for (const status of [302, 307, 401, 403, 429, 500]) {
    it(`rejects HTTP ${status}`, async () => {
      const fetchImpl = async () => new Response('Monthly usage $25 of $100', { status });
      const result = await fetchOllamaCloudQuota({ readCookie, fetchImpl });
      expect(result.ok).toBe(false);
      expect(result.usage).toBe(null);
      expect(result.error).toBe('Ollama Cloud authentication failed');
    });
  }

  for (const failure of [new DOMException('Request timed out', 'TimeoutError'), new Error('Network unavailable')]) {
    it(`reports ${failure.message}`, async () => {
      const fetchImpl = async () => { throw failure; };
      const result = await fetchOllamaCloudQuota({ readCookie, fetchImpl });
      expect(result.ok).toBe(false);
      expect(result.usage).toBe(null);
      expect(result.error).toBe(failure.message);
    });
  }

  it('does not request usage without a cookie', async () => {
    const result = await fetchOllamaCloudQuota({
      readCookie: () => undefined,
      fetchImpl: async () => { throw new Error('Unexpected request'); },
    });
    expect(result.configured).toBe(false);
    expect(result.ok).toBe(false);
  });

  it('reports response body failures', async () => {
    const failure = new Error('Response body interrupted');
    const fetchImpl = async () => new Response(new ReadableStream({
      start(controller) {
        controller.error(failure);
      },
    }));
    const result = await fetchOllamaCloudQuota({ readCookie, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.configured).toBe(true);
    expect(result.usage).toBe(null);
    expect(result.error).toBe(failure.message);
  });
});
