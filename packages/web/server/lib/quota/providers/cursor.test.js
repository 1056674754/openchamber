import { describe, expect, it } from 'vitest';

import { parseCursorUsageWindows } from './cursor.js';

describe('Cursor quota windows', () => {
  it('uses the billing-cycle start and end timestamps for paced metrics', () => {
    // Given Cursor returns its billing-cycle timestamps as numeric strings
    const usage = {
      billingCycleStart: '1782785115000',
      billingCycleEnd: '1785377115000',
      planUsage: {
        autoPercentUsed: 50,
      },
    };

    // When the quota response is normalized
    const windows = parseCursorUsageWindows(usage, null);

    // Then Auto retains the complete 30-day window and reset timestamp
    expect(windows.auto.windowSeconds).toBe(30 * 24 * 60 * 60);
    expect(windows.auto.resetAt).toBe(1_785_377_115_000);
  });
});
