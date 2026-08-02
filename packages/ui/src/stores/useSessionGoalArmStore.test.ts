import { beforeEach, describe, expect, test } from 'bun:test';

import { useSessionGoalArmStore } from './useSessionGoalArmStore';

// The arm store is the timing-safety mechanism behind "Continue working" on a
// completed goal: clicking that button only arms the store (pure local state,
// no metadata patch / no send), and the original objective is carried through
// `objectiveOverride` so the reactivation keeps auditing the same task. These
// tests lock that contract so a future change cannot silently turn arming into
// an immediate state change or drop the objective override.
describe('useSessionGoalArmStore', () => {
  beforeEach(() => {
    useSessionGoalArmStore.setState({ armed: false, objectiveOverride: null });
  });

  test('starts disarmed with no override', () => {
    expect(useSessionGoalArmStore.getState().armed).toBe(false);
    expect(useSessionGoalArmStore.getState().objectiveOverride).toBeNull();
  });

  test('arming without an override keeps the override null', () => {
    useSessionGoalArmStore.getState().setArmed(true);

    const result = useSessionGoalArmStore.getState().consume();
    expect(result).toEqual({ armed: true, objectiveOverride: null });
  });

  test('arming with an override round-trips it through consume', () => {
    useSessionGoalArmStore.getState().setArmed(true, 'Finish the original task');

    const result = useSessionGoalArmStore.getState().consume();
    expect(result).toEqual({ armed: true, objectiveOverride: 'Finish the original task' });
  });

  test('consume is read-and-clear: a second consume is disarmed', () => {
    useSessionGoalArmStore.getState().setArmed(true, 'objective');

    expect(useSessionGoalArmStore.getState().consume()).toEqual({ armed: true, objectiveOverride: 'objective' });
    expect(useSessionGoalArmStore.getState().consume()).toEqual({ armed: false, objectiveOverride: null });
    expect(useSessionGoalArmStore.getState().armed).toBe(false);
    expect(useSessionGoalArmStore.getState().objectiveOverride).toBeNull();
  });

  test('disarming drops any previously set override', () => {
    useSessionGoalArmStore.getState().setArmed(true, 'objective');
    useSessionGoalArmStore.getState().setArmed(false, 'ignored-when-disarming');

    expect(useSessionGoalArmStore.getState().armed).toBe(false);
    expect(useSessionGoalArmStore.getState().objectiveOverride).toBeNull();
  });

  test('arming alone does not touch goal metadata — the store is local-only', () => {
    // The store exposes no network/metadata surface; arming is a pure state
    // set. This documents the timing guarantee: until consume() runs in the
    // send path, nothing leaves the browser.
    const before = useSessionGoalArmStore.getState();
    useSessionGoalArmStore.getState().setArmed(true, 'objective');
    const after = useSessionGoalArmStore.getState();

    expect(after.armed).toBe(true);
    expect(after.objectiveOverride).toBe('objective');
    // Only the two arm fields changed — no other property leaked onto the store.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  });
});
