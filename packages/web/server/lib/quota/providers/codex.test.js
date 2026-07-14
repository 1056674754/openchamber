import { describe, expect, test } from 'bun:test';
import { parseCodexUsageWindows } from './codex.js';

describe('Codex quota windows', () => {
  test('labels a weekly-only primary window from its duration', () => {
    const windows = parseCodexUsageWindows({
      rate_limit: {
        primary_window: {
          used_percent: 3,
          limit_window_seconds: 604800,
          reset_at: 1784491827,
        },
      },
    });

    expect(windows.weekly.usedPercent).toBe(3);
    expect(windows['5h']).toBeUndefined();
  });

  test('labels five-hour and weekly windows independently', () => {
    const windows = parseCodexUsageWindows({
      rate_limit: {
        primary_window: { used_percent: 10, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 20, limit_window_seconds: 604800 },
      },
    });

    expect(windows['5h'].usedPercent).toBe(10);
    expect(windows.weekly.usedPercent).toBe(20);
  });
});
