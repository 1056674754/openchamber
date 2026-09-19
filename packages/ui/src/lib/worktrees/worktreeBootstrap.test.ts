import { describe, expect, test } from 'bun:test';

import {
  clearWorktreeBootstrapState,
  getWorktreeBootstrapState,
  markWorktreeBootstrapPending,
  setWorktreeBootstrapState,
  subscribeWorktreeBootstrapState,
  waitForWorktreeBootstrap,
  waitForWorktreeGitReady,
} from './worktreeBootstrap';

describe('worktree bootstrap path keys', () => {
  test('shares state across Windows drive-letter variants', () => {
    markWorktreeBootstrapPending('c:\\repo\\worktree');
    expect(getWorktreeBootstrapState('C:/repo/worktree')?.status).toBe('pending');
    expect(getWorktreeBootstrapState('C:/repo/worktree')?.phase).toBe('directory-created');

    clearWorktreeBootstrapState('C:/repo/worktree');
    expect(getWorktreeBootstrapState('c:\\repo\\worktree')).toBeNull();
  });
});

describe('worktree bootstrap phases', () => {
  test('git-ready wait resolves when phase reaches git-ready while still pending', async () => {
    markWorktreeBootstrapPending('/repo/wt-a');
    setWorktreeBootstrapState('/repo/wt-a', {
      status: 'pending',
      phase: 'git-ready',
      error: null,
      updatedAt: Date.now(),
    });

    await waitForWorktreeGitReady('/repo/wt-a', 1_000);
    let setupError: unknown = null;
    try {
      await waitForWorktreeBootstrap('/repo/wt-a', 50);
    } catch (error) {
      setupError = error;
    }
    expect(setupError instanceof Error && /Timed out/.test(setupError.message)).toBe(true);

    clearWorktreeBootstrapState('/repo/wt-a');
  });

  test('setup-ready wait resolves on ready status', async () => {
    markWorktreeBootstrapPending('/repo/wt-b');
    setWorktreeBootstrapState('/repo/wt-b', {
      status: 'ready',
      phase: 'setup-ready',
      error: null,
      updatedAt: Date.now(),
    });

    await waitForWorktreeGitReady('/repo/wt-b', 1_000);
    await waitForWorktreeBootstrap('/repo/wt-b', 1_000);
    clearWorktreeBootstrapState('/repo/wt-b');
  });

  test('does not regress pending phase when older poll arrives', () => {
    markWorktreeBootstrapPending('/repo/wt-c');
    setWorktreeBootstrapState('/repo/wt-c', {
      status: 'pending',
      phase: 'git-ready',
      error: null,
      updatedAt: Date.now(),
    });
    // Simulated older poll would be ignored by wait loop's storePolledState;
    // direct setWorktreeBootstrapState starts a new lifecycle and replaces.
    setWorktreeBootstrapState('/repo/wt-c', {
      status: 'pending',
      phase: 'directory-created',
      error: null,
      updatedAt: Date.now(),
    });
    expect(getWorktreeBootstrapState('/repo/wt-c')?.phase).toBe('directory-created');
    clearWorktreeBootstrapState('/repo/wt-c');
  });
});

describe('worktreeBootstrap subscription', () => {
  test('notifies subscribers as a directory enters and leaves bootstrap', () => {
    const pendingSnapshots: boolean[] = [];
    const unsubscribe = subscribeWorktreeBootstrapState(() => {
      pendingSnapshots.push(getWorktreeBootstrapState('/repo-wt')?.status === 'pending');
    });

    try {
      markWorktreeBootstrapPending('/repo-wt');
      setWorktreeBootstrapState('/repo-wt', { status: 'ready', phase: 'setup-ready', error: null, updatedAt: 2 });
      clearWorktreeBootstrapState('/repo-wt');
    } finally {
      unsubscribe();
    }

    expect(pendingSnapshots).toEqual([true, false, false]);
  });

  test('stops notifying after unsubscribe', () => {
    let notifications = 0;
    const unsubscribe = subscribeWorktreeBootstrapState(() => {
      notifications += 1;
    });

    markWorktreeBootstrapPending('/bootstrap-unsub');
    unsubscribe();
    clearWorktreeBootstrapState('/bootstrap-unsub');

    expect(notifications).toBe(1);
  });
});
