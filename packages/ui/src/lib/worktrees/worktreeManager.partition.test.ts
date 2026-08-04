import { describe, expect, mock, test } from 'bun:test';
import type { WorktreeMetadata } from '@/types/worktree';

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => ({
      availableWorktrees: [],
      availableWorktreesByProject: new Map(),
      worktreeMetadata: new Map(),
      setState: () => {},
    }),
  },
}));

mock.module('@/lib/gitApi', () => ({
  git: { raw: async () => '' },
  deleteRemoteBranch: async () => null,
  getGitStatus: async () => ({ branch: '', files: [], ahead: 0, behind: 0, isClean: true, staged: [], unstaged: [], untracked: [] }),
  getGitBranches: async () => [],
  checkIsGitRepository: async () => false,
}));

mock.module('@/lib/gitApiHttp', () => ({}));

mock.module('@/lib/execCommands', () => ({
  execCommand: () => '',
}));

mock.module('@/lib/openchamberConfig', () => ({
  substituteCommandVariables: (value: string) => value,
}));

const { partitionWorktreesByRegisteredProject } = await import('./worktreeManager');

const worktree = (path: string, projectDirectory = '/repo'): WorktreeMetadata => {
  const label = path.split('/').pop() ?? path;
  return { path, projectDirectory, branch: label, label };
};

describe('partitionWorktreesByRegisteredProject', () => {
  test('assigns shared topology to the primary project and omits configured worktree projects', () => {
    const projects = [
      { path: '/repo' },
      { path: '/worktrees/alpha' },
      { path: '/worktrees/beta' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/repo', [
        worktree('/worktrees/alpha'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/beta', [
        worktree('/repo'),
        worktree('/worktrees/alpha'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/repo']);
    expect(result.get('/repo')?.map((entry) => entry.path)).toEqual(['/worktrees/loose']);
  });

  test('uses the first configured checkout when the primary project is not configured', () => {
    const projects = [
      { path: '/worktrees/alpha' },
      { path: '/worktrees/beta' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/worktrees/beta', [
        worktree('/repo'),
        worktree('/worktrees/alpha'),
        worktree('/worktrees/loose'),
      ]],
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/beta'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/worktrees/alpha']);
    expect(result.get('/worktrees/alpha')?.map((entry) => entry.path)).toEqual([
      '/repo',
      '/worktrees/loose',
    ]);
  });

  test('keeps primary ownership when topology comes from another configured checkout', () => {
    const projects = [
      { path: '/repo' },
      { path: '/worktrees/alpha' },
    ];
    const topology = new Map<string, WorktreeMetadata[]>([
      ['/worktrees/alpha', [
        worktree('/repo'),
        worktree('/worktrees/loose'),
      ]],
    ]);

    const result = partitionWorktreesByRegisteredProject(projects, topology);

    expect([...result.keys()]).toEqual(['/repo']);
    expect(result.get('/repo')?.map((entry) => entry.path)).toEqual(['/worktrees/loose']);
  });
});
