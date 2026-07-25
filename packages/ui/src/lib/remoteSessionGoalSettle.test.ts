import { describe, expect, test } from 'bun:test';
import { detectRemoteGoalSettleTransition } from '@/lib/remoteSessionGoalSettle';

describe('detectRemoteGoalSettleTransition', () => {
  test('fires when leaving active/paused for a settle status', () => {
    expect(detectRemoteGoalSettleTransition('active', 'complete')).toBe('complete');
    expect(detectRemoteGoalSettleTransition('paused', 'budgetLimited')).toBe('budgetLimited');
    expect(detectRemoteGoalSettleTransition('active', 'blocked')).toBe('blocked');
  });

  test('ignores non-settle or already-settled transitions', () => {
    expect(detectRemoteGoalSettleTransition(null, 'complete')).toBe(null);
    expect(detectRemoteGoalSettleTransition('complete', 'complete')).toBe(null);
    expect(detectRemoteGoalSettleTransition('blocked', 'complete')).toBe(null);
    expect(detectRemoteGoalSettleTransition('active', 'paused')).toBe(null);
    expect(detectRemoteGoalSettleTransition('active', 'active')).toBe(null);
  });
});
