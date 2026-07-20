import { describe, expect, test } from 'bun:test';

import type { ProjectEntry } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';

import { resolveProjectForSessionDirectory } from './projectResolution';

describe('resolveProjectForSessionDirectory', () => {
  test('prefers an explicitly registered nested project over an ancestor worktree', () => {
    const parentProject: ProjectEntry = {
      id: 'parent-project',
      path: '/repos/parent',
      serverId: 'remote-parent',
    };
    const nestedProject: ProjectEntry = {
      id: 'nested-project',
      path: '/repos/parent/packages/child',
      serverId: 'remote-child',
    };
    const parentWorktree: WorktreeMetadata = {
      path: '/repos/parent/packages',
      projectDirectory: parentProject.path,
      serverId: parentProject.serverId,
      branch: 'feature',
      label: 'feature',
    };
    const worktreesByProject = new Map<string, WorktreeMetadata[]>([
      [`${parentProject.serverId}::${parentProject.path}`, [parentWorktree]],
    ]);

    const resolved = resolveProjectForSessionDirectory(
      [parentProject, nestedProject],
      worktreesByProject,
      '/repos/parent/packages/child/src',
    );

    expect(resolved).toEqual(nestedProject);
  });
});
