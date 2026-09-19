import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { WorktreeMetadata } from '@/types/worktree'

type WorktreeListEntry = {
  path?: string
  branch?: string
  head?: string
  name?: string
  prunable?: boolean
}

const listCalls: string[] = []
const warningToasts: string[] = []
const createdResults: Record<string, unknown>[] = []
const sessionUIState: {
  availableWorktrees: WorktreeMetadata[]
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>
  worktreeMetadata: Map<string, WorktreeMetadata | null>
} = {
  availableWorktrees: [],
  availableWorktreesByProject: new Map(),
  worktreeMetadata: new Map(),
}

let listImplementation: (directory: string) => Promise<WorktreeListEntry[]>

mock.module('@/lib/gitApi', () => ({
  deleteRemoteBranch: mock(async () => undefined),
  git: {
    worktree: {
      list: (directory: string) => {
        listCalls.push(directory)
        return listImplementation(directory)
      },
      create: mock(async () => createdResults.shift() ?? null),
      validate: mock(async () => ({ ok: true, errors: [] })),
      remove: mock(async () => ({ success: true })),
    },
  },
}))

mock.module('@/lib/gitApiHttp', () => ({
  listGitWorktrees: (directory: string) => {
    listCalls.push(directory)
    return listImplementation(directory)
  },
  createGitWorktree: mock(async () => createdResults.shift() ?? null),
  validateGitWorktree: mock(async () => ({ ok: true, errors: [] })),
  deleteGitWorktree: mock(async () => ({ success: true })),
  deleteRemoteBranch: mock(async () => undefined),
}))

mock.module('@/lib/execCommands', () => ({
  execCommand: async () => ({ success: false, stdout: '', stderr: '' }),
}))

mock.module('@/lib/openchamberConfig', () => ({
  substituteCommandVariables: (command: string) => command,
}))

mock.module('@/components/ui', () => ({
  toast: {
    warning: (message: string) => warningToasts.push(message),
    loading: mock(() => 'toast-id'),
    success: mock(),
    error: mock(),
  },
}))

mock.module('@/lib/i18n/store', () => ({
  formatMessage: () => 'session.newWorktree.toast.fetchSourceFailed',
  useI18nStore: { getState: () => ({ dictionary: {} }) },
}))

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  clearWorktreeBootstrapState: mock(),
  markWorktreeBootstrapPending: mock(),
  setWorktreeBootstrapState: mock(),
}))

mock.module('@/lib/worktrees/worktreeStatus', () => ({
  invalidateResolvedProjectRootCache: mock(),
}))

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => sessionUIState,
    setState: (patch: Record<string, unknown> | ((state: Record<string, unknown>) => Record<string, unknown>)) => {
      const next = patch instanceof Function ? patch(sessionUIState as unknown as Record<string, unknown>) : patch
      Object.assign(sessionUIState, next)
    },
  },
}))

mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    get: () => undefined,
  },
}))

const {
  createWorktree,
  listProjectWorktrees,
  notifyWorktreeTopologyChanged,
  removeProjectWorktree,
  subscribeWorktreeTopologyChanged,
} = await import('./worktreeManager')

describe('worktreeManager missing worktrees and topology signals', () => {
  beforeEach(() => {
    listCalls.length = 0
    warningToasts.length = 0
    createdResults.length = 0
    listImplementation = async () => []
    sessionUIState.availableWorktrees = []
    sessionUIState.availableWorktreesByProject = new Map()
    sessionUIState.worktreeMetadata = new Map()
  })

  test('warns when worktree creation falls back after a source fetch failure', async () => {
    createdResults.push({ name: 'feature', path: '/repo/.worktrees/feature', branch: 'feature', sourceFetchFailed: true })

    await createWorktree({ id: 'project-fetch-fallback', path: '/repo' }, {
      branchName: 'feature',
      worktreeName: 'feature',
    })

    expect(warningToasts).toEqual(['session.newWorktree.toast.fetchSourceFailed'])
  })

  test('keeps a prunable worktree in the topology as missing instead of dropping it', async () => {
    listImplementation = async () => [
      { path: '/repo-missing/.worktrees/alive', branch: 'alive', head: 'abc', name: 'alive' },
      { path: '/repo-missing/.worktrees/gone', branch: 'gone', head: 'def', name: 'gone', prunable: true },
    ]

    const result = await listProjectWorktrees({ id: 'project-missing', path: '/repo-missing' }, { force: true })

    expect(result.map((entry) => [entry.path, entry.worktreeStatus])).toEqual([
      ['/repo-missing/.worktrees/alive', 'ready'],
      ['/repo-missing/.worktrees/gone', 'missing'],
    ])
  })

  test('a topology-changed signal drops the cached listing and reaches subscribers', async () => {
    const project = { id: 'project-signal', path: '/repo-signal/' }
    listImplementation = async () => []
    await listProjectWorktrees(project, { force: true })
    await listProjectWorktrees(project)
    expect(listCalls).toEqual(['/repo-signal'])

    const notified: string[] = []
    const unsubscribe = subscribeWorktreeTopologyChanged((directory) => notified.push(directory))
    notifyWorktreeTopologyChanged('/repo-signal/')
    unsubscribe()
    notifyWorktreeTopologyChanged('/repo-signal')

    expect(notified).toEqual(['/repo-signal'])
    await listProjectWorktrees(project)
    expect(listCalls).toEqual(['/repo-signal', '/repo-signal'])
  })

  test('removes a worktree from sidebar topology owned by another registered checkout', async () => {
    const removed: WorktreeMetadata = {
      path: '/worktrees/removed',
      projectDirectory: '/repo',
      branch: 'removed',
      label: 'removed',
    }
    const sibling: WorktreeMetadata = {
      path: '/worktrees/sibling',
      projectDirectory: '/repo',
      branch: 'sibling',
      label: 'sibling',
    }
    const unrelatedEntries: WorktreeMetadata[] = [{
      path: '/other/worktree',
      projectDirectory: '/other',
      branch: 'other',
      label: 'other',
    }]
    sessionUIState.availableWorktreesByProject = new Map([
      ['/worktrees/configured', [removed, sibling]],
      ['/other', unrelatedEntries],
    ])
    sessionUIState.availableWorktrees = [removed, sibling, ...unrelatedEntries]
    sessionUIState.worktreeMetadata = new Map([
      ['removed-session', removed],
      ['sibling-session', sibling],
    ])

    await removeProjectWorktree({ id: 'path:/repo', path: '/repo' }, removed)

    expect(sessionUIState.availableWorktreesByProject.get('/worktrees/configured')).toEqual([sibling])
    expect(sessionUIState.availableWorktreesByProject.get('/other')).toBe(unrelatedEntries)
    expect(sessionUIState.availableWorktrees).toEqual([sibling, ...unrelatedEntries])
    expect(sessionUIState.worktreeMetadata.has('removed-session')).toBe(false)
    expect(sessionUIState.worktreeMetadata.get('sibling-session')).toBe(sibling)
  })

  test('keeps a same-path worktree owned by another server when removing', async () => {
    const remoteWorktree: WorktreeMetadata = {
      path: '/worktrees/shared',
      projectDirectory: '/repo',
      branch: 'shared',
      label: 'shared',
      serverId: 'remote-x',
    }
    const localWorktree: WorktreeMetadata = {
      path: '/worktrees/shared',
      projectDirectory: '/repo',
      branch: 'shared',
      label: 'shared',
    }
    sessionUIState.availableWorktreesByProject = new Map([
      ['remote-x::/repo', [remoteWorktree]],
      ['/repo', [localWorktree]],
    ])
    sessionUIState.availableWorktrees = [remoteWorktree, localWorktree]

    await removeProjectWorktree({ id: 'path:/repo', path: '/repo' }, localWorktree)

    expect(sessionUIState.availableWorktreesByProject.get('remote-x::/repo')).toEqual([remoteWorktree])
    expect(sessionUIState.availableWorktreesByProject.get('/repo')).toEqual([])
    expect(sessionUIState.availableWorktrees).toEqual([remoteWorktree])
  })
})
