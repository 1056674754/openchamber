import { describe, expect, it } from 'vitest';

import { toClaudeUsage } from './transforms.js';

const PAYLOAD = {
  limits: [
    { kind: 'session', percent: 5, resets_at: '2026-08-14T19:10:00Z', scope: null },
    { kind: 'weekly_all', percent: 4, resets_at: '2026-08-20T15:00:00Z', scope: null },
    { kind: 'weekly_scoped', percent: 12, resets_at: '2026-08-20T15:00:00Z', scope: { model: { display_name: 'Fable' } } },
  ],
  spend: {
    used: { amount_minor: 250, currency: 'USD', exponent: 2 },
    limit: { amount_minor: 10000, currency: 'USD', exponent: 2 },
    percent: 2.5,
    enabled: true,
  },
};

describe('Claude usage transforms', () => {
  it('maps plan and model-scoped limits with their durations', () => {
    const { windows, models } = toClaudeUsage(PAYLOAD);
    expect(windows['5h']).toMatchObject({ usedPercent: 5, windowSeconds: 5 * 60 * 60 });
    expect(windows['7d']).toMatchObject({ usedPercent: 4, windowSeconds: 7 * 24 * 60 * 60 });
    expect(models.Fable.windows['7d'].usedPercent).toBe(12);
  });

  it('reports enabled extra usage and omits disabled extra usage', () => {
    expect(toClaudeUsage(PAYLOAD).windows.extra_usage.valueLabel).toBe('$2.50 / $100.00');
    expect(toClaudeUsage({ ...PAYLOAD, spend: { enabled: false } }).windows.extra_usage).toBeUndefined();
  });

  it('falls back to legacy fields and ignores malformed data', () => {
    const legacy = toClaudeUsage({
      five_hour: { utilization: 3, resets_at: '2026-08-14T19:10:00Z' },
      seven_day: { utilization: 9, resets_at: '2026-08-20T15:00:00Z' },
    });
    expect(legacy.windows['5h'].usedPercent).toBe(3);
    expect(legacy.windows['7d'].usedPercent).toBe(9);
    expect(toClaudeUsage(null)).toEqual({ windows: {}, models: {} });
  });
});
