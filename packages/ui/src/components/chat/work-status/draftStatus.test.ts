import { describe, expect, test } from 'bun:test';

import type { ProjectEntry } from '@/lib/api/types';
import type { ProviderResult } from '@/types/quota';
import type { WorktreeMetadata } from '@/types/worktree';

import { resolveDraftWorkStatusAuthority, summarizeDraftQuota } from './draftStatus';

const localProject: ProjectEntry = {
  id: 'local-project',
  path: '/workspace/app',
};

const remoteProject: ProjectEntry = {
  id: 'remote-project',
  path: '/workspace/app',
  serverId: 'dev3',
};

const draft = (overrides: Record<string, unknown> = {}) => ({
  open: true,
  selectedProjectId: remoteProject.id,
  directoryOverride: remoteProject.path,
  permissionIntent: { mode: "ask" },
  parentID: null,
  ...overrides,
});

describe('resolveDraftWorkStatusAuthority', () => {
  test('keeps an explicitly selected remote project when a local project has the same path', () => {
    const authority = resolveDraftWorkStatusAuthority({
      draft: draft(),
      projects: [localProject, remoteProject],
      availableWorktreesByProject: new Map(),
      activeProjectId: localProject.id,
    });

    expect(authority).toEqual({
      directory: '/workspace/app',
      project: remoteProject,
      serverId: 'dev3',
    });
  });

  test('fails closed when the explicit project no longer exists', () => {
    const authority = resolveDraftWorkStatusAuthority({
      draft: draft({ selectedProjectId: 'deleted-project' }),
      projects: [localProject],
      availableWorktreesByProject: new Map(),
      activeProjectId: localProject.id,
    });

    expect(authority).toEqual({
      directory: '/workspace/app',
      project: null,
      serverId: null,
    });
  });

  test('uses the pending worktree directory before the original override', () => {
    const authority = resolveDraftWorkStatusAuthority({
      draft: draft({ bootstrapPendingDirectory: '/workspace/app-feature' }),
      projects: [remoteProject],
      availableWorktreesByProject: new Map(),
      activeProjectId: null,
    });

    expect(authority?.directory).toBe('/workspace/app-feature');
    expect(authority?.serverId).toBe('dev3');
  });

  test('resolves a sibling worktree to its owning project without an explicit selection', () => {
    const worktree: WorktreeMetadata = {
      path: '/workspace/app-feature',
      projectDirectory: remoteProject.path,
      serverId: remoteProject.serverId,
      branch: 'feature',
      label: 'feature',
    };
    const authority = resolveDraftWorkStatusAuthority({
      draft: draft({ selectedProjectId: null, directoryOverride: worktree.path }),
      projects: [remoteProject],
      availableWorktreesByProject: new Map([
        [`${remoteProject.serverId}::${remoteProject.path}`, [worktree]],
      ]),
      activeProjectId: null,
    });

    expect(authority?.project).toEqual(remoteProject);
    expect(authority?.serverId).toBe('dev3');
  });
});

describe('summarizeDraftQuota', () => {
  test('counts configured providers and finds the tightest provider or model window', () => {
    const results: ProviderResult[] = [
      {
        providerId: 'codex',
        providerName: 'Codex',
        ok: true,
        configured: true,
        fetchedAt: 1,
        usage: {
          windows: {
            fiveHour: {
              usedPercent: 40,
              remainingPercent: 60,
              windowSeconds: 18_000,
              resetAfterSeconds: null,
              resetAt: null,
              resetAtFormatted: null,
              resetAfterFormatted: null,
            },
          },
        },
      },
      {
        providerId: 'google',
        providerName: 'Google',
        ok: true,
        configured: true,
        fetchedAt: 1,
        usage: {
          windows: {},
          models: {
            gemini: {
              windows: {
                daily: {
                  usedPercent: 88,
                  remainingPercent: null,
                  windowSeconds: 86_400,
                  resetAfterSeconds: null,
                  resetAt: null,
                  resetAtFormatted: null,
                  resetAfterFormatted: null,
                },
              },
            },
          },
        },
      },
      {
        providerId: 'claude',
        providerName: 'Claude',
        ok: false,
        configured: false,
        fetchedAt: 1,
        usage: null,
      },
    ];

    expect(summarizeDraftQuota(results)).toEqual({
      configuredProviders: 2,
      lowestRemainingPercent: 12,
    });
  });

  test('reports an empty summary without inventing quota data', () => {
    expect(summarizeDraftQuota([])).toEqual({
      configuredProviders: 0,
      lowestRemainingPercent: null,
    });
  });
});
