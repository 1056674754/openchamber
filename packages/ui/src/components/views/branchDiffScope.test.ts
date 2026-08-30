import { describe, expect, test } from 'bun:test';
import {
  branchRangeKey,
  coerceDiffScope,
  isBranchScopeAvailable,
  isBranchScopeDefinitelyUnavailable,
} from './branchDiffScope';

describe('branch diff scope', () => {
  test('is offered only for a known non-default branch', () => {
    expect(isBranchScopeAvailable('feature', 'main')).toBe(true);
    expect(isBranchScopeAvailable('main', 'main')).toBe(false);
    expect(isBranchScopeAvailable('feature', null)).toBe(false);
    expect(isBranchScopeAvailable(null, 'main')).toBe(false);
  });

  test('does not coerce while metadata is unresolved', () => {
    expect(isBranchScopeDefinitelyUnavailable('feature', null, false, false)).toBe(false);
    expect(coerceDiffScope('branch', true)).toBe('branch');
  });

  test('coerces on detached head, default branch, or settled missing metadata', () => {
    expect(isBranchScopeDefinitelyUnavailable(null, null, true, false)).toBe(true);
    expect(isBranchScopeDefinitelyUnavailable('main', 'main', true, true)).toBe(true);
    expect(isBranchScopeDefinitelyUnavailable('feature', null, true, true)).toBe(true);
    expect(coerceDiffScope('branch', false)).toBe('working');
  });

  test('range keys isolate directory, base, and head', () => {
    const key = branchRangeKey('/repo', 'main', 'feature');
    expect(key).not.toBe(branchRangeKey('/repo', 'release', 'feature'));
    expect(key).not.toBe(branchRangeKey('/other', 'main', 'feature'));
    expect(key).not.toBe(branchRangeKey('/repo', 'main', 'other'));
  });
});
