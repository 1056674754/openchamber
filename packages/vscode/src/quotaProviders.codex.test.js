import { describe, expect, it } from 'bun:test';
import { parseCodexUsageWindows } from './quotaProviders.ts';

describe('VS Code Codex quota provider', () => {
  it('preserves business spend limits including zero values', () => {
    const populated = parseCodexUsageWindows({
      spend_control: {
        individual_limit: {
          limit: '7500',
          used: '2674.8724080324173',
          used_percent: 36,
        },
      },
    });
    const zero = parseCodexUsageWindows({
      spend_control: {
        individual_limit: {
          limit: 0,
          used: 0,
          used_percent: 0,
        },
      },
    });

    expect(populated.credits).toMatchObject({
      usedPercent: 36,
      valueLabel: '2675 / 7500 used',
    });
    expect(zero.credits).toMatchObject({
      usedPercent: 0,
      valueLabel: '0 / 0 used',
    });
    expect(parseCodexUsageWindows({}).credits).toBeUndefined();
    expect(parseCodexUsageWindows({
      spend_control: { individual_limit: {} },
    }).credits).toBeUndefined();
  });
});
