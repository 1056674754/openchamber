import { describe, expect, test } from 'bun:test';

import {
  clearWorktreeBootstrapState,
  getWorktreeBootstrapState,
  markWorktreeBootstrapPending,
} from './worktreeBootstrap';

describe('worktree bootstrap path keys', () => {
  test('shares state across Windows drive-letter variants', () => {
    markWorktreeBootstrapPending('c:\\repo\\worktree');
    expect(getWorktreeBootstrapState('C:/repo/worktree')?.status).toBe('pending');

    clearWorktreeBootstrapState('C:/repo/worktree');
    expect(getWorktreeBootstrapState('c:\\repo\\worktree')).toBeNull();
  });
});
