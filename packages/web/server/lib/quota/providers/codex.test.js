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

  test('surfaces a business spend limit as the credits window', () => {
    const windows = parseCodexUsageWindows({
      spend_control: {
        individual_limit: {
          limit: '7500',
          used: '2674.8724080324173',
          used_percent: 36,
        },
      },
    });

    expect(windows.credits.usedPercent).toBe(36);
    expect(windows.credits.valueLabel).toBe('2675 / 7500 used');
  });

  test('preserves zero-valued business spend limits', () => {
    const windows = parseCodexUsageWindows({
      spend_control: {
        individual_limit: {
          limit: 0,
          used: 0,
          used_percent: 0,
        },
      },
    });

    expect(windows.credits.usedPercent).toBe(0);
    expect(windows.credits.valueLabel).toBe('0 / 0 used');
  });

  test('does not fabricate a spend window from missing fields', () => {
    expect(parseCodexUsageWindows({}).credits).toBeUndefined();
    expect(parseCodexUsageWindows({
      spend_control: { individual_limit: {} },
    }).credits).toBeUndefined();
  });
});
