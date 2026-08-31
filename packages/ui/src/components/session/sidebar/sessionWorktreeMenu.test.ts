import { describe, expect, mock, test } from 'bun:test'

import type { ProjectRef } from '@/lib/worktrees/worktreeManager'
import type { WorktreeMetadata } from '@/types/worktree'

import {
  buildSessionWorktreeMenuTargets,
  getSessionWorktreeMenuState,
  isSessionWorktreeTargetMoveDisabled,
  startSessionWorktreeMenuLoad,
} from './sessionWorktreeMenu'

const makeWorktree = (overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata => ({
  path: '/repo',
  projectDirectory: '/repo',
  branch: '',
  label: 'repo',
  worktreeStatus: 'ready',
  ...overrides,
})

describe('buildSessionWorktreeMenuTargets', () => {
  test('classifies the repository primary first and marks the current worktree', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [
        makeWorktree({ path: '/repo', projectDirectory: '/repo', label: 'primary' }),
        makeWorktree({ path: '/repo-feature', projectDirectory: '/repo', branch: 'feature', label: 'feature' }),
        makeWorktree({ path: '/repo-fix', projectDirectory: '/repo', branch: 'fix', label: 'fix' }),
      ],
      sourceDirectory: '/repo-feature',
      currentWorktree: null,
    })

    expect(targets.map((target) => [target.metadata.path, target.isPrimary, target.isCurrent])).toEqual([
      ['/repo', true, false],
      ['/repo-feature', false, true],
      ['/repo-fix', false, false],
    ])
  })

  test('synthesizes a primary target when discovery omitted the repository root', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [
        makeWorktree({ path: '/repo-feature', projectDirectory: '/repo', branch: 'feature', label: 'feature' }),
      ],
      sourceDirectory: '/repo-feature',
      currentWorktree: null,
    })

    expect(targets).toHaveLength(2)
    expect(targets[0]?.isPrimary).toBe(true)
    expect(targets[0]?.metadata.path).toBe('/repo')
    expect(targets[0]?.metadata.worktreeStatus).toBe('ready')
  })

  test('synthesizes the source directory when it is not part of discovered worktrees', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [],
      sourceDirectory: '/elsewhere',
      currentWorktree: null,
    })

    expect(targets.map((target) => target.metadata.path)).toEqual(['/repo', '/elsewhere'])
    expect(targets[0]?.isPrimary).toBe(true)
    expect(targets[1]?.isCurrent).toBe(true)
  })

  test('deduplicates targets that normalize to the same path', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [
        makeWorktree({ path: '/repo-feature', projectDirectory: '/repo', branch: 'feature', label: 'feature' }),
        makeWorktree({ path: '/repo-feature/', projectDirectory: '/repo', branch: 'feature', label: 'duplicate' }),
      ],
      sourceDirectory: null,
      currentWorktree: null,
    })

    expect(targets).toHaveLength(2)
    expect(targets.filter((target) => target.metadata.path === '/repo-feature')).toHaveLength(1)
  })

  test('keeps the current worktree metadata authoritative for the synthetic entry', () => {
    const targets = buildSessionWorktreeMenuTargets({
      projectPath: '/repo',
      discoveredWorktrees: [],
      sourceDirectory: '/repo-feature',
      currentWorktree: makeWorktree({
        path: '/repo-feature',
        branch: 'wt-branch',
        label: 'WT Label',
        worktreeStatus: 'ready',
      }),
    })

    const current = targets.find((target) => target.isCurrent)
    expect(current?.metadata.branch).toBe('wt-branch')
    expect(current?.metadata.label).toBe('WT Label')
  })
})

describe('isSessionWorktreeTargetMoveDisabled', () => {
  test('disables the current worktree', () => {
    expect(isSessionWorktreeTargetMoveDisabled({
      metadata: makeWorktree({ path: '/here' }),
      isPrimary: false,
      isCurrent: true,
    })).toBe(true)
  })

  test('disables explicitly not-ready worktrees but keeps unknown status movable', () => {
    expect(isSessionWorktreeTargetMoveDisabled({
      metadata: makeWorktree({ worktreeStatus: 'missing' }),
      isPrimary: false,
      isCurrent: false,
    })).toBe(true)
    expect(isSessionWorktreeTargetMoveDisabled({
      metadata: makeWorktree({ worktreeStatus: undefined }),
      isPrimary: false,
      isCurrent: false,
    })).toBe(false)
  })
})

describe('startSessionWorktreeMenuLoad', () => {
  const makeDeps = (overrides: Partial<Parameters<typeof startSessionWorktreeMenuLoad>[1]> = {}) => {
    const published = new Map<string, WorktreeMetadata[]>()
    const listCalls: Array<{ project: ProjectRef; force: boolean }> = []
    const publishedWrites: Array<{ projectPath: string; worktrees: WorktreeMetadata[] }> = []
    const deps = {
      getProjects: () => [
        { id: 'project-1', path: '/repo' },
        { id: 'project-remote', path: '/remote/repo', serverId: 'remote-a' },
      ] as ProjectRef[],
      getPublishedWorktreesByProject: () => published,
      getPublishedWorktrees: () => [...published.values()].flat(),
      getProjectWorktrees: (map: Map<string, WorktreeMetadata[]>, path: string, serverId?: string | null) => {
        const key = serverId && serverId !== 'default' ? `${serverId}::${path}` : path
        return map.get(key) ?? (serverId ? [] : map.get(path) ?? [])
      },
      resolveProject: mock((directory: string) => {
        void directory
        return null
      }),
      listProjectWorktrees: mock(async (project: ProjectRef, options: { force: true }) => {
        listCalls.push({ project, force: options.force })
        return [
          makeWorktree({ path: `${project.path}-feature`, projectDirectory: project.path, branch: 'feature', label: 'feature' }),
        ]
      }),
      publishProjectWorktrees: mock((args: { project: ProjectRef; worktrees: WorktreeMetadata[] }) => {
        publishedWrites.push({ projectPath: args.project.path, worktrees: args.worktrees })
        const key = args.project.serverId && args.project.serverId !== 'default'
          ? `${args.project.serverId}::${args.project.path}`
          : args.project.path
        published.set(key, args.worktrees)
      }),
      getRuntimeKey: () => 'local',
      ...overrides,
    }
    return { deps, listCalls, publishedWrites, published }
  }

  test('serves cached targets from the published server-scoped map and forces a refresh', async () => {
    const { deps, listCalls, published } = makeDeps()
    published.set('remote-a::/remote/repo', [
      makeWorktree({ path: '/remote/repo-existing', projectDirectory: '/remote/repo', serverId: 'remote-a', branch: 'existing', label: 'existing' }),
    ])

    const load = startSessionWorktreeMenuLoad(
      { projectId: 'project-remote', sourceDirectory: '/remote/repo-existing', currentWorktree: null },
      deps,
    )

    expect(load.cachedTargets.map((target) => target.metadata.path)).toEqual(['/remote/repo', '/remote/repo-existing'])
    // The cached answer is available synchronously even though the forced
    // refresh is already in flight.

    const fresh = await load.refreshTargets
    expect(listCalls).toEqual([
      { project: { id: 'project-remote', path: '/remote/repo', serverId: 'remote-a' }, force: true },
    ])
    expect(fresh.map((target) => target.metadata.path)).toEqual([
      '/remote/repo',
      '/remote/repo-feature',
      // The session's current worktree dropped out of the refreshed listing;
      // it stays reachable as a synthetic current entry (disabled for moves).
      '/remote/repo-existing',
    ])
    expect(fresh.find((target) => target.metadata.path === '/remote/repo-existing')?.isCurrent).toBe(true)
  })

  test('republishes the refreshed project through the provided publish authority', async () => {
    const { deps, publishedWrites } = makeDeps()

    const load = startSessionWorktreeMenuLoad(
      { projectId: 'project-1', sourceDirectory: '/repo', currentWorktree: null },
      deps,
    )
    await load.refreshTargets

    expect(publishedWrites).toHaveLength(1)
    expect(publishedWrites[0]?.projectPath).toBe('/repo')
    expect(publishedWrites[0]?.worktrees.map((worktree) => worktree.path)).toEqual(['/repo-feature'])
  })

  test('aborts the refresh when the runtime endpoint changes mid-flight', async () => {
    let runtimeKey = 'local'
    const { deps } = makeDeps({ getRuntimeKey: () => runtimeKey })

    const load = startSessionWorktreeMenuLoad(
      { projectId: 'project-1', sourceDirectory: '/repo', currentWorktree: null },
      deps,
    )
    runtimeKey = 'url:https://other'

    await expect(load.refreshTargets).rejects.toThrow('Runtime changed during worktree refresh')
  })

  test('aborts the refresh when the project was removed mid-flight', async () => {
    let projects: ProjectRef[] = [{ id: 'project-1', path: '/repo' }]
    const { deps } = makeDeps({ getProjects: () => projects })

    const load = startSessionWorktreeMenuLoad(
      { projectId: 'project-1', sourceDirectory: '/repo', currentWorktree: null },
      deps,
    )
    projects = []

    await expect(load.refreshTargets).rejects.toThrow('Project removed during worktree refresh')
  })

  test('fails when no project can be resolved', async () => {
    const { deps } = makeDeps()

    const load = startSessionWorktreeMenuLoad(
      { projectId: null, sourceDirectory: null, currentWorktree: null },
      deps,
    )

    expect(load.cachedTargets).toEqual([])
    await expect(load.refreshTargets).rejects.toThrow('Unable to resolve worktree project')
  })
})

describe('getSessionWorktreeMenuState', () => {
  test('reports loading while refreshing and error only with no targets', () => {
    expect(getSessionWorktreeMenuState({ targets: [], isRefreshing: true, loadFailed: false }).refreshState).toBe('loading')
    expect(getSessionWorktreeMenuState({ targets: [], isRefreshing: false, loadFailed: true }).refreshState).toBe('error')
    expect(
      getSessionWorktreeMenuState({
        targets: [{ metadata: makeWorktree(), isPrimary: true, isCurrent: false }],
        isRefreshing: false,
        loadFailed: true,
      }).refreshState,
    ).toBe(null)
    expect(getSessionWorktreeMenuState({ targets: [], isRefreshing: false, loadFailed: false }).showNewWorktreeAction).toBe(true)
  })
})
