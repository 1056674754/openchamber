import { describe, expect, test } from 'bun:test';

import type { WorktreeMetadata } from '@/types/worktree';
import {
  buildWorktreeDiscoveryQueue,
  mergeProjectWorktreeResult,
  pruneWorktreesForDiscoveryQueue,
} from './worktreeDiscovery';

const worktree = (path: string, label = path): WorktreeMetadata => ({
  path,
  projectDirectory: '/repo',
  branch: label,
  label,
});

describe('worktree discovery ordering', () => {
  test('queues pinned projects first while preserving user project order', () => {
    const queue = buildWorktreeDiscoveryQueue([
      { id: 'project-a', path: '/repo/a' },
      { id: 'project-b', path: '/repo/b', pinned: true },
      { id: 'project-c', path: '/repo/c' },
      { id: 'unavailable', path: '/repo/missing', unavailable: true },
      { id: 'remote-root', path: '/', serverId: 'remote-1' },
    ]);

    expect(queue.map((project) => project.id)).toEqual(['project-b', 'project-a', 'project-c']);
    expect(queue.map((project) => project.normalizedPath)).toEqual(['/repo/b', '/repo/a', '/repo/c']);
  });

  test('merges each project result without waiting for the whole discovery batch', () => {
    const previous = new Map<string, WorktreeMetadata[]>([
      ['/repo/a', [worktree('/repo/a-wt-old')]],
      ['/repo/b', [worktree('/repo/b-wt-old')]],
    ]);
    const orderedProjectKeys = ['/repo/b', '/repo/a'];

    const next = mergeProjectWorktreeResult({
      currentByProject: previous,
      projectKey: '/repo/b',
      legacyProjectKey: '/repo/b',
      worktrees: [worktree('/repo/b-wt-new')],
      orderedProjectKeys,
    });

    expect(next.byProject.get('/repo/b')?.map((item) => item.path)).toEqual(['/repo/b-wt-new']);
    expect(next.byProject.get('/repo/a')?.map((item) => item.path)).toEqual(['/repo/a-wt-old']);
    expect(next.allWorktrees.map((item) => item.path)).toEqual(['/repo/b-wt-new', '/repo/a-wt-old']);
  });

  test('removes stale worktrees for a project that now has none', () => {
    const previous = new Map<string, WorktreeMetadata[]>([
      ['remote-1::/repo/a', [worktree('/repo/a-wt-old')]],
    ]);

    const next = mergeProjectWorktreeResult({
      currentByProject: previous,
      projectKey: 'remote-1::/repo/a',
      legacyProjectKey: '/repo/a',
      worktrees: [],
      orderedProjectKeys: ['remote-1::/repo/a'],
    });

    expect(next.byProject.has('remote-1::/repo/a')).toBe(false);
    expect(next.byProject.has('/repo/a')).toBe(false);
    expect(next.allWorktrees).toEqual([]);
  });

  test('prunes stale project keys outside the current discovery queue', () => {
    const queue = buildWorktreeDiscoveryQueue([
      { id: 'project-a', path: '/repo/a' },
    ]);
    const previous = new Map<string, WorktreeMetadata[]>([
      ['/repo/a', [worktree('/repo/a-wt')]],
      ['/repo/removed', [worktree('/repo/removed-wt')]],
    ]);

    const next = pruneWorktreesForDiscoveryQueue(previous, queue);

    expect(next.byProject.has('/repo/a')).toBe(true);
    expect(next.byProject.has('/repo/removed')).toBe(false);
    expect(next.allWorktrees.map((item) => item.path)).toEqual(['/repo/a-wt']);
  });

  test('normalizes retained legacy keys to the current discovery key', () => {
    const queue = buildWorktreeDiscoveryQueue([
      { id: 'project-a', path: '/repo/a', serverId: 'remote-1' },
    ]);
    const previous = new Map<string, WorktreeMetadata[]>([
      ['/repo/a', [worktree('/repo/a-wt')]],
    ]);

    const next = pruneWorktreesForDiscoveryQueue(previous, queue);

    expect(next.byProject.has('/repo/a')).toBe(false);
    expect(next.byProject.get('remote-1::/repo/a')?.map((item) => item.path)).toEqual(['/repo/a-wt']);
    expect(next.allWorktrees.map((item) => item.path)).toEqual(['/repo/a-wt']);
  });
});
