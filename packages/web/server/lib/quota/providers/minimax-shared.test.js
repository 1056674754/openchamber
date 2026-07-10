import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../opencode/auth.js', () => ({
  readAuthFile: vi.fn(() => ({
    'minimax-coding-plan': { key: 'test-key' },
  })),
}));

import { fetchQuota } from './minimax-coding-plan.js';

const createResponse = (ok, payload) => ({
  ok,
  json: vi.fn(async () => payload),
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('MiniMax token plan quota provider', () => {
  it('uses token_plan/remains first and treats usage_count as remaining quota', async () => {
    const fetchMock = vi.fn(async () => createResponse(true, {
      base_resp: { status_code: 0 },
      model_remains: [{
        model_name: 'MiniMax-M1',
        current_interval_total_count: 100,
        current_interval_usage_count: 25,
        current_weekly_status: 3,
      }],
    }));
    globalThis.fetch = fetchMock;

    const result = await fetchQuota();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.minimax.io/v1/token_plan/remains');
    expect(result.ok).toBe(true);
    expect(result.usage.windows['5h'].usedPercent).toBe(75);
    expect(result.usage.windows.weekly).toBeUndefined();
  });

  it('falls back to coding_plan/remains and keeps legacy consumed-count semantics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(false, {}))
      .mockResolvedValueOnce(createResponse(true, {
        base_resp: { status_code: 0 },
        model_remains: [{
          model_name: 'general',
          current_interval_total_count: 100,
          current_interval_usage_count: 25,
          current_weekly_status: 3,
        }],
      }));
    globalThis.fetch = fetchMock;

    const result = await fetchQuota();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.minimax.io/v1/api/openplatform/coding_plan/remains');
    expect(result.ok).toBe(true);
    expect(result.usage.windows['5h'].usedPercent).toBe(25);
  });
});
