import { describe, expect, test } from 'bun:test';
import type { WorktreeMetadata } from '@/types/worktree';

import { dedupeWorktreesByPath, getProjectWorktreeKey } from './worktreeKeys';

const worktree = (path: string, overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata => ({
  path,
  projectDirectory: '/repo',
  branch: '',
  label: path.split('/').filter(Boolean).pop() ?? path,
  ...overrides,
});

describe('worktree keys', () => {
  test('scopes keys by non-default server id', () => {
    expect(getProjectWorktreeKey('/repo/wvh', 'remote-a')).toBe('remote-a::/repo/wvh');
    expect(getProjectWorktreeKey('/repo/wvh', 'default')).toBe('/repo/wvh');
  });

  test('dedupes worktrees by normalized path and server', () => {
    const result = dedupeWorktreesByPath([
      worktree('/repo/wvh/', { serverId: 'remote-a', label: 'wvh' }),
      worktree('/repo/wvh', { serverId: 'remote-a', branch: 'wvh', name: 'wvh' }),
      worktree('/repo/wvh', { serverId: 'remote-b', label: 'wvh remote b' }),
    ]);

    expect(result).toHaveLength(2);
    expect({
      path: result[0]?.path,
      serverId: result[0]?.serverId,
      branch: result[0]?.branch,
      name: result[0]?.name,
    }).toEqual({
      path: '/repo/wvh',
      serverId: 'remote-a',
      branch: 'wvh',
      name: 'wvh',
    });
    expect({
      path: result[1]?.path,
      serverId: result[1]?.serverId,
      label: result[1]?.label,
    }).toEqual({
      path: '/repo/wvh',
      serverId: 'remote-b',
      label: 'wvh remote b',
    });
  });

  test('uses fallback server id for metadata without server ids', () => {
    const result = dedupeWorktreesByPath([
      worktree('/repo/wvh'),
      worktree('/repo/wvh/', { branch: 'wvh' }),
    ], 'remote-a');

    expect(result).toHaveLength(1);
    expect({
      path: result[0]?.path,
      serverId: result[0]?.serverId,
      branch: result[0]?.branch,
    }).toEqual({
      path: '/repo/wvh',
      serverId: 'remote-a',
      branch: 'wvh',
    });
  });
});
