import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { WorktreeMetadata } from '@/types/worktree'

type WorktreeListEntry = {
  path?: string
  branch?: string
  head?: string
  name?: string
}

const listCalls: string[] = []
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
      create: mock(async () => null),
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
  createGitWorktree: mock(async () => null),
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

const { listProjectWorktrees } = await import('./worktreeManager')

const makeEntry = (path: string, branch = ''): WorktreeListEntry => ({ path, branch, head: branch })

const flush = async (count = 6): Promise<void> => {
  for (let i = 0; i < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('listProjectWorktrees force refresh', () => {
  beforeEach(() => {
    listCalls.length = 0
    sessionUIState.availableWorktrees = []
    sessionUIState.availableWorktreesByProject = new Map()
    sessionUIState.worktreeMetadata = new Map()
  })

  test('forced refresh bypasses a fresh cached result', async () => {
    let call = 0
    listImplementation = async () => {
      call += 1
      return call === 1 ? [] : [makeEntry('/repo-feature', 'feature')]
    }

    const project = { id: 'p1', path: '/repo-force-cache' }
    const initialResult = await listProjectWorktrees(project)
    expect(initialResult).toEqual([])

    const cachedResult = await listProjectWorktrees(project)
    expect(cachedResult).toEqual([])
    expect(listCalls).toEqual(['/repo-force-cache'])

    const forcedResult = await listProjectWorktrees(project, { force: true })
    expect(forcedResult.map((entry) => entry.path)).toEqual(['/repo-feature'])

    const refreshedCachedResult = await listProjectWorktrees(project)
    expect(refreshedCachedResult.map((entry) => entry.path)).toEqual(['/repo-feature'])
    expect(listCalls).toEqual(['/repo-force-cache', '/repo-force-cache'])
  })

  test('forced refresh starts a new request instead of joining an older in-flight list', async () => {
    let generation = 0
    let firstCallHeld = false
    const pendingHolds: Array<(entries: WorktreeListEntry[]) => void> = []
    listImplementation = () =>
      new Promise((resolve) => {
        if (!firstCallHeld) {
          firstCallHeld = true
          pendingHolds.push(resolve)
          return
        }
        resolve(generation === 0 ? [] : [makeEntry('/repo-feature', 'feature')])
      })

    const project = { id: 'p1', path: '/repo-force-inflight' }
    const initialListing = listProjectWorktrees(project)
    await flush(2)

    generation = 1
    const forcedListing = listProjectWorktrees(project, { force: true })
    await flush(2)
    expect(listCalls).toHaveLength(2)

    // The stale pre-invalidation completion arrives late and cannot satisfy
    // the initial request; its stable-read retry observes the new generation.
    pendingHolds.shift()?.([])
    const initial = await initialListing
    expect(initial.map((entry) => entry.path)).toEqual(['/repo-feature'])

    const forced = await forcedListing
    expect(forced.map((entry) => entry.path)).toEqual(['/repo-feature'])
  })

  test('older completions do not replace a forced refresh result with stale topology', async () => {
    let generation = 0
    let firstCallHeld = false
    const pendingHolds: Array<(entries: WorktreeListEntry[]) => void> = []
    listImplementation = () =>
      new Promise((resolve) => {
        if (!firstCallHeld) {
          firstCallHeld = true
          pendingHolds.push(resolve)
          return
        }
        resolve(generation === 0 ? [] : [makeEntry('/repo-feature', 'feature')])
      })

    const project = { id: 'p1', path: '/repo-force-stale' }
    const initialListing = listProjectWorktrees(project)
    await flush(2)

    generation = 1
    const forcedListing = listProjectWorktrees(project, { force: true })
    await flush(2)

    pendingHolds.shift()?.([])
    await initialListing

    const forced = await forcedListing
    expect(forced.map((entry) => entry.path)).toEqual(['/repo-feature'])

    const cached = await listProjectWorktrees(project)
    expect(cached.map((entry) => entry.path)).toEqual(['/repo-feature'])
  })

  test('rejects when git worktree listing fails instead of reporting an empty repo', async () => {
    listImplementation = async () => {
      throw new Error('git failed')
    }

    const project = { id: 'p1', path: '/repo-force-error' }
    await expect(listProjectWorktrees(project)).rejects.toThrow('git failed')

    // The failure is not cached: a later successful listing is served.
    listImplementation = async () => [makeEntry('/repo-feature', 'feature')]
    const recovered = await listProjectWorktrees(project)
    expect(recovered.map((entry) => entry.path)).toEqual(['/repo-feature'])
  })

  test('partitions listings per server authority', async () => {
    listImplementation = async () => [makeEntry('/srv/repo-feature', 'feature')]

    const localProject = { id: 'local', path: '/srv/repo' }
    const remoteProject = { id: 'remote', path: '/srv/repo', serverId: 'remote-a' }

    const localResult = await listProjectWorktrees(localProject)
    const remoteResult = await listProjectWorktrees(remoteProject)

    expect(localResult.map((entry) => entry.path)).toEqual(['/srv/repo-feature'])
    expect(remoteResult.map((entry) => entry.path)).toEqual(['/srv/repo-feature'])
    expect(remoteResult[0]?.serverId).toBe('remote-a')
    // Separate cache entries: two listings for the same path.
    expect(listCalls).toEqual(['/srv/repo', '/srv/repo'])
  })
})
