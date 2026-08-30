import { describe, expect, test } from 'bun:test';

import {
  MOBILE_RESUME_RETRY_DELAYS_MS,
  runMobileResumeProbeLadder,
} from './useMobileConnectionResume';
import type { ReprobeOutcome } from '@/apps/mobileConnections';

describe('mobile resume probe ladder', () => {
  test('uses fast probes before a final full-budget probe', async () => {
    const probes: boolean[] = [];
    const waits: number[] = [];
    const outcomes: ReprobeOutcome[] = ['unreachable', 'unreachable', 'unchanged'];
    const result = await runMobileResumeProbeLadder({
      probe: async ({ fast }) => {
        probes.push(fast);
        return outcomes.shift() ?? 'unreachable';
      },
      wait: async (delayMs) => { waits.push(delayMs); },
    });

    expect(result).toBe('unchanged');
    expect(probes).toEqual([true, true, false]);
    expect(waits).toEqual([...MOBILE_RESUME_RETRY_DELAYS_MS]);
  });

  test('does not retry terminal auth or no-connection outcomes', async () => {
    for (const terminal of ['needs-login', 'no-connection'] as const) {
      let waits = 0;
      const result = await runMobileResumeProbeLadder({
        probe: async () => terminal,
        wait: async () => { waits += 1; },
      });
      expect(result).toBe(terminal);
      expect(waits).toBe(0);
    }
  });

  test('cancellation after a delay prevents the next probe', async () => {
    let cancelled = false;
    let probes = 0;
    const result = await runMobileResumeProbeLadder({
      probe: async () => { probes += 1; return 'unreachable'; },
      wait: async () => { cancelled = true; },
      isCancelled: () => cancelled,
    });
    expect(result).toBeNull();
    expect(probes).toBe(1);
  });
});
