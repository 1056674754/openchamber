import { describe, expect, test } from 'bun:test';

import { resolveProjectKnowledgeOwnerPath } from './project-resolution.js';

describe('session knowledge project resolution', () => {
  test('prefers the longest registered project containing the directory', async () => {
    const result = await resolveProjectKnowledgeOwnerPath({
      directory: '/repos/root/packages/app/src',
      projects: [{ path: '/repos/root' }, { path: '/repos/root/packages/app' }],
      resolvePrimaryWorktreeRoot: async () => ({ root: '/unused' }),
    });

    expect(result).toBe('/repos/root/packages/app');
  });

  test('maps a sibling linked worktree back to its primary registered project', async () => {
    const result = await resolveProjectKnowledgeOwnerPath({
      directory: '/worktrees/app-feature',
      projects: [{ path: '/repos/app' }],
      resolvePrimaryWorktreeRoot: async () => ({ root: '/repos/app' }),
    });

    expect(result).toBe('/repos/app');
  });

  test('does not substitute an unrelated project when ownership is unresolved', async () => {
    const result = await resolveProjectKnowledgeOwnerPath({
      directory: '/unknown/path',
      projects: [{ path: '/repos/app' }],
      resolvePrimaryWorktreeRoot: async () => ({ root: '/unknown/path' }),
    });

    expect(result).toBeNull();
  });
});
