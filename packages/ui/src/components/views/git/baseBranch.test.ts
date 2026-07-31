import { describe, expect, test } from 'bun:test';
import { deriveBaseBranch } from './baseBranch';

describe('deriveBaseBranch', () => {
  test('prefers worktree metadata and removes a known remote prefix', () => {
    const branch = deriveBaseBranch({
      remoteNames: new Set(['origin']),
      localBranches: ['main', 'feature'],
      worktreeCreatedFromBranch: 'remotes/origin/release',
      rootBranchHint: 'main',
    });

    expect(branch).toBe('release');
  });

  test('uses the repository root hint when worktree metadata is absent', () => {
    const branch = deriveBaseBranch({
      remoteNames: new Set(['upstream']),
      localBranches: ['develop', 'feature'],
      rootBranchHint: 'refs/heads/develop',
    });

    expect(branch).toBe('develop');
  });

  test('falls back to the first conventional local base branch', () => {
    const branch = deriveBaseBranch({
      remoteNames: new Set(),
      localBranches: ['master', 'feature'],
    });

    expect(branch).toBe('master');
  });
});
