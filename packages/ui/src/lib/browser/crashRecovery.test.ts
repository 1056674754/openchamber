import { describe, expect, test } from 'bun:test';

import {
  CRASH_RECOVERY_BASE_DELAY_MS,
  CRASH_RECOVERY_MAX_ATTEMPTS,
  CRASH_RECOVERY_WINDOW_MS,
  INITIAL_CRASH_RECOVERY_STATE,
  planCrashRecovery,
} from './crashRecovery';

describe('Browser renderer crash recovery', () => {
  test('backs off and stops after the bounded attempts', () => {
    let state = INITIAL_CRASH_RECOVERY_STATE;
    const delays: number[] = [];
    for (let index = 0; index < CRASH_RECOVERY_MAX_ATTEMPTS; index += 1) {
      const plan = planCrashRecovery(state, 1_000 + index);
      expect(plan === null).toBe(false);
      state = plan!.state;
      delays.push(plan!.delayMs);
    }
    expect(delays).toEqual([
      CRASH_RECOVERY_BASE_DELAY_MS,
      CRASH_RECOVERY_BASE_DELAY_MS * 2,
      CRASH_RECOVERY_BASE_DELAY_MS * 4,
    ]);
    expect(planCrashRecovery(state, 1_100)).toBeNull();
  });

  test('starts a fresh budget after the recovery window', () => {
    const exhausted = { attempts: CRASH_RECOVERY_MAX_ATTEMPTS, windowStartedAt: 1_000 };
    expect(planCrashRecovery(exhausted, 1_000 + CRASH_RECOVERY_WINDOW_MS)).toEqual({
      delayMs: CRASH_RECOVERY_BASE_DELAY_MS,
      state: { attempts: 1, windowStartedAt: 1_000 + CRASH_RECOVERY_WINDOW_MS },
    });
  });
});
