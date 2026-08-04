import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: () => ({ kimi: { key: 'test-token' } })
}));

import { fetchQuota } from './kimi.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Kimi quota provider', () => {
  it('uses used when present and falls back to remaining', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        usage: { limit: 100, used: 25, remaining: 1 },
        limits: [{
          window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
          detail: { limit: 200, remaining: 50 }
        }]
      })
    }));

    const result = await fetchQuota();

    expect(result.ok).toBe(true);
    expect(result.usage.windows.weekly.usedPercent).toBe(25);
    expect(result.usage.windows['Rate Limit (5h)'].usedPercent).toBe(75);
  });
});
