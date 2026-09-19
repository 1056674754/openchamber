import { describe, expect, test } from 'bun:test';
import { buildKnownSessionDirectories } from './sessionListDirectories';

describe('buildKnownSessionDirectories', () => {
  test('normalizes project roots and optionally includes worktrees', () => {
    const worktrees = new Map([
      ['/repo', [{ path: '/repo/worktree', projectDirectory: '/repo', branch: 'worktree', label: 'worktree' }]],
    ]);

    expect([...buildKnownSessionDirectories([{ path: '/Repo' }], worktrees)]).toEqual([
      '/Repo',
      '/repo/worktree',
    ]);
    expect([...buildKnownSessionDirectories([{ path: '/Repo' }], worktrees, { includeWorktrees: false })]).toEqual([
      '/Repo',
    ]);
  });

  test('preserves case-sensitive directories and normalizes Windows separators without lowercasing names', () => {
    expect([...buildKnownSessionDirectories([
      { path: '/srv/Project' }, { path: '/srv/project' },
      { path: 'c:\\Users\\Developer\\Project\\' }, { path: 'C:/Users/Developer/Project' },
    ], new Map())]).toEqual(['/srv/Project', '/srv/project', 'C:/Users/Developer/Project']);
  });
});
