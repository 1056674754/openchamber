import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { Session, SessionStatus } from '@opencode-ai/sdk/v2'

import { markAmbiguousTransportFailure } from '@/lib/relay/transport-error'
import type { ProjectRef } from '@/lib/worktrees/worktreeManager'
import type { WorktreeMetadata } from '@/types/worktree'
import type { SessionTreeMoveIntent, SessionTreeMoveMessages } from './sessionWorktreeMove'

const moveCalls: Array<{
  sessionId: string
  sourceDirectory: string
  destinationDirectory: string
  moveChanges: boolean
}> = []
const refreshCalls: string[][] = []
const removeWorktreeCalls: Array<{ projectPath: string; directory: string; deleteLocalBranch: boolean }> = []
const createQuickWorktreeCalls: Array<{ project: ProjectRef; options: { startRef?: string } }> = []
const ensureWorktreeProjectCalls: Array<{ path: string; projectId: string }> = []
const metadataWrites: Array<{ sessionId: string; metadata: unknown }> = []
const toastSuccesses: string[] = []
const toastErrors: Array<{ title: string; description?: string }> = []
const folderScopesRewritten: Array<{ sessionIds: string[]; source: string; destination: string }> = []
const queuedTargetsRewritten: Array<{ sessionIds: string[]; source: string; destination: string }> = []

type DirectoryState = { session_status: Record<string, SessionStatus> }
const directoryStates = new Map<string, DirectoryState>()
const storedMetadata = new Map<string, unknown>()

type SessionUIStatePatch = Record<string, unknown>
const sessionUIState = {
  availableWorktrees: [] as unknown[],
  availableWorktreesByProject: new Map<string, unknown[]>(),
  worktreeMetadata: new Map<string, unknown>(),
  getWorktreeMetadata: (sessionId: string) => storedMetadata.get(sessionId) ?? undefined,
  setWorktreeMetadata: (sessionId: string, metadata: unknown) => {
    storedMetadata.set(sessionId, metadata)
    metadataWrites.push({ sessionId, metadata })
  },
}

let moveSessionImplementation: (
  session: Session,
  sourceDirectory: string,
  destinationDirectory: string,
  moveChanges: boolean,
) => Promise<void> = async () => {}
let refreshImplementation: (directories: string[]) => Promise<void> = async () => {}
let isGitRepositoryImplementation = async (directory: string): Promise<boolean> => {
  void directory
  return true
}
let getGitStatusImplementation = async (directory: string): Promise<{
  current: string
  isClean: boolean
  files: Array<{ path: string; index: string; working_dir: string }>
}> => {
  void directory
  return { current: 'feature', isClean: true, files: [] }
}
let createQuickWorktreeImplementation: (
  project: ProjectRef,
  options: { startRef?: string },
) => Promise<Record<string, unknown>> = async () => ({
  path: '/created-worktree',
  projectDirectory: '/repo',
  branch: 'feature',
  label: 'Created worktree',
  worktreeStatus: 'ready',
  worktreeSource: 'created-for-session',
})
let resolveProjectRefImplementation = (directory: string): ProjectRef | null => {
  void directory
  return { id: 'project-1', path: '/repo' }
}
let waitForWorktreeGitReadyImplementation = async (directory: string): Promise<void> => {
  void directory
}
let getServerForSessionImplementation = (sessionId: string): string | null => {
  void sessionId
  return null
}

mock.module('@/components/ui', () => ({
  toast: {
    success: (message: string) => {
      toastSuccesses.push(message)
    },
    error: (title: string, options?: { description?: string }) => {
      toastErrors.push({ title, description: options?.description })
    },
  },
}))

mock.module('@/lib/gitApi', () => ({
  checkIsGitRepository: (directory: string) => isGitRepositoryImplementation(directory),
  getGitStatus: (directory: string) => getGitStatusImplementation(directory),
}))

mock.module('@/lib/worktreeSessionCreator', () => ({
  createQuickWorktree: mock((project: ProjectRef, options: { startRef?: string }) => {
    createQuickWorktreeCalls.push({ project, options })
    return createQuickWorktreeImplementation(project, options)
  }),
  resolveProjectRef: mock((directory: string) => resolveProjectRefImplementation(directory)),
  ensureWorktreeProject: mock((path: string, projectRef: ProjectRef) => {
    ensureWorktreeProjectCalls.push({ path, projectId: projectRef.id })
  }),
}))

mock.module('@/lib/worktrees/worktreeBootstrap', () => ({
  waitForWorktreeGitReady: mock((directory: string) => waitForWorktreeGitReadyImplementation(directory)),
}))

mock.module('@/lib/worktrees/worktreeManager', () => ({
  getLatestWorktreeMetadata: (metadata: Record<string, unknown>) => metadata,
  removeProjectWorktree: mock(async (project: ProjectRef, worktree: { path: string }, options?: { deleteLocalBranch?: boolean }) => {
    removeWorktreeCalls.push({
      projectPath: project.path,
      directory: worktree.path,
      deleteLocalBranch: options?.deleteLocalBranch === true,
    })
  }),
}))

mock.module('@/stores/useGlobalSessionsStore', () => ({
  refreshGlobalSessionsForDirectories: (directories: string[]) => {
    refreshCalls.push(directories)
    return refreshImplementation(directories)
  },
}))

// Mirrors session-actions: every server's child stores are scanned, because a
// session's live status can be reported by a directory other than its own, and
// "no store covers this session" is 'unknown', never 'idle'.
const getSessionLiveActivity = (sessionId: string): 'unknown' | 'idle' | 'active' => {
  for (const state of directoryStates.values()) {
    const status = state.session_status[sessionId]
    if (status && status.type !== 'idle') return 'active'
  }
  for (const state of directoryStates.values()) {
    if (Object.hasOwn(state.session_status, sessionId)) return 'idle'
  }
  return 'unknown'
}

mock.module('@/sync/session-actions', () => ({
  moveSessionToDirectory: (
    session: Session,
    sourceDirectory: string,
    destinationDirectory: string,
    moveChanges = true,
  ) => {
    moveCalls.push({ sessionId: session.id, sourceDirectory, destinationDirectory, moveChanges })
    return moveSessionImplementation(session, sourceDirectory, destinationDirectory, moveChanges)
  },
  getSessionLiveActivity,
  isSessionBusyNow: (sessionId: string) => getSessionLiveActivity(sessionId) === 'active',
}))

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => sessionUIState,
    setState: (patch: SessionUIStatePatch | ((state: SessionUIStatePatch) => SessionUIStatePatch)) => {
      const next = patch instanceof Function ? patch(sessionUIState) : patch
      Object.assign(sessionUIState, next)
    },
  },
}))

mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    getServerForSession: (sessionId: string) => getServerForSessionImplementation(sessionId),
  },
}))

// Fork migrations are real store operations; capture the call contract while
// keeping the move test independent of folder/queue store internals.
mock.module('@/lib/worktrees/sessionWorktreeMoveMigrations', () => ({
  migrateSessionFoldersForMove: (sessionIds: string[], source: string, destination: string) => {
    folderScopesRewritten.push({ sessionIds, source, destination })
  },
  migrateQueuedSendTargetsForMove: (sessionIds: string[], source: string, destination: string) => {
    queuedTargetsRewritten.push({ sessionIds, source, destination })
  },
}))

const {
  moveSessionTreeToExistingWorktree,
  requestSessionTreeMove,
  confirmSessionTreeMove,
  cancelSessionTreeMove,
  getSessionTreeMoveConfirmation,
} = await import('./sessionWorktreeMove')

const confirmationPending = (): boolean => getSessionTreeMoveConfirmation() !== null

const makeSession = (id: string): Session => ({
  id,
  projectID: 'project-1',
  directory: '/source',
  title: id,
  version: '1',
  time: { created: 0, updated: 0 },
} as unknown as Session)

const makeWorktreeMetadata = (overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata => ({
  path: '/destination',
  projectDirectory: '/repo',
  branch: 'feature',
  label: 'Destination',
  worktreeStatus: 'ready',
  worktreeSource: 'existing',
  ...overrides,
})

const makeMoveMessages = (): SessionTreeMoveMessages => ({
  success: 'move succeeded',
  failure: 'move failed',
  sourceVerificationFailed: 'source verification failed',
  applyChangesFailed: 'apply changes failed',
  changesMayBeInDestination: 'changes may be in destination',
})

const makeQuickIntent = (): SessionTreeMoveIntent => ({
  kind: 'quick',
  root: makeSession('root'),
  descendants: [],
  sourceDirectory: '/source',
  messages: makeMoveMessages(),
})

const makeSessionStatus = (type: SessionStatus['type']): SessionStatus => {
  switch (type) {
    case 'busy':
      return { type: 'busy' }
    case 'idle':
      return { type: 'idle' }
    case 'retry':
      return { type: 'retry', attempt: 1, message: 'retry', next: 0 }
  }
}

const setStatuses = (directory: string, statuses: Record<string, SessionStatus['type']>): void => {
  directoryStates.set(directory, {
    session_status: Object.fromEntries(
      Object.entries(statuses).map(([sessionId, type]) => [sessionId, makeSessionStatus(type)]),
    ),
  })
}

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for condition')
}

const resetState = () => {
  cancelSessionTreeMove()
  moveCalls.length = 0
  refreshCalls.length = 0
  removeWorktreeCalls.length = 0
  createQuickWorktreeCalls.length = 0
  ensureWorktreeProjectCalls.length = 0
  metadataWrites.length = 0
  toastSuccesses.length = 0
  toastErrors.length = 0
  folderScopesRewritten.length = 0
  queuedTargetsRewritten.length = 0
  directoryStates.clear()
  storedMetadata.clear()
  sessionUIState.availableWorktrees = []
  sessionUIState.availableWorktreesByProject = new Map()
  sessionUIState.worktreeMetadata = new Map()
  moveSessionImplementation = async () => {}
  refreshImplementation = async () => {}
  isGitRepositoryImplementation = async () => true
  getGitStatusImplementation = async () => ({ current: 'feature', isClean: true, files: [] })
  createQuickWorktreeImplementation = async () => ({
    path: '/created-worktree',
    projectDirectory: '/repo',
    branch: 'feature',
    label: 'Created worktree',
    worktreeStatus: 'ready',
    worktreeSource: 'created-for-session',
  })
  resolveProjectRefImplementation = () => ({ id: 'project-1', path: '/repo' })
  waitForWorktreeGitReadyImplementation = async () => {}
  getServerForSessionImplementation = () => null
}

describe('moveSessionTreeToExistingWorktree', () => {
  beforeEach(resetState)

  test('moves descendants before the root, only transfers changes once, migrates fork scopes, and refreshes both directories', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle', grandchild: 'idle' })

    const destination = makeWorktreeMetadata()
    const result = await moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child'), makeSession('grandchild')],
      sourceDirectory: '/source',
      destination,
      moveChanges: true,
    })

    expect(result).toBe('/destination')
    expect(moveCalls.map((call) => call.sessionId)).toEqual(['child', 'grandchild', 'root'])
    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([
      { sessionId: 'root', sourceDirectory: '/source', destinationDirectory: '/destination', moveChanges: true },
    ])
    expect(refreshCalls).toEqual([['/source', '/destination']])
    expect(folderScopesRewritten).toEqual([
      { sessionIds: ['child', 'grandchild', 'root'], source: '/source', destination: '/destination' },
    ])
    expect(queuedTargetsRewritten).toEqual([
      { sessionIds: ['child', 'grandchild', 'root'], source: '/source', destination: '/destination' },
    ])
    expect(ensureWorktreeProjectCalls).toEqual([])
  })

  test('rejects a destination that normalizes to the source directory', async () => {
    setStatuses('/source', { root: 'idle' })

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source/',
      destination: makeWorktreeMetadata({ path: '/source' }),
      moveChanges: true,
    })).rejects.toThrow('Source and destination are the same')

    expect(moveCalls).toEqual([])
  })

  test('rejects a destination worktree explicitly marked not ready', async () => {
    setStatuses('/source', { root: 'idle' })

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata({ worktreeStatus: 'missing' }),
      moveChanges: true,
    })).rejects.toThrow('Destination worktree is not ready')

    expect(moveCalls).toEqual([])
  })

  test('allows a remote-discovered destination without an explicit worktree status', async () => {
    setStatuses('/source', { root: 'idle' })

    const result = await moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata({ worktreeStatus: undefined }),
      moveChanges: false,
    })

    expect(result).toBe('/destination')
    expect(moveCalls).toHaveLength(1)
  })

  test('[fork] rejects a destination that belongs to a different server', async () => {
    setStatuses('/source', { root: 'idle' })
    getServerForSessionImplementation = () => 'remote-a'

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata({ serverId: 'remote-b' }),
      moveChanges: true,
    })).rejects.toThrow('Destination worktree belongs to a different server')

    expect(moveCalls).toEqual([])
  })

  test('rejects when any session is busy before setup', async () => {
    setStatuses('/source', { root: 'idle', child: 'busy' })

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('Session is not idle')

    expect(moveCalls).toEqual([])
  })

  test('refuses to move a session whose live status no store covers', async () => {
    setStatuses('/source', {})

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('Session status is unavailable')
  })

  test('refuses to move a session reported busy by another directory', async () => {
    setStatuses('/source', { root: 'idle' })
    setStatuses('/elsewhere', { root: 'busy' })

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('Session is not idle')
  })

  test('rejects a duplicate move request while the root move is pending', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    let gateOpen = false
    moveSessionImplementation = () => new Promise<void>((resolve) => {
      const check = () => {
        if (gateOpen) resolve()
        else setTimeout(check, 1)
      }
      check()
    })

    const first = moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })
    await waitFor(() => moveCalls.length > 0)

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata({ path: '/other' }),
      moveChanges: true,
    })).rejects.toThrow('Session move already in progress')

    gateOpen = true
    expect(await first).toBe('/destination')
  })

  test('rolls back completed moves in reverse order without transferring changes and never removes an existing destination', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle', grandchild: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'grandchild') throw new Error('boom')
    }

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child'), makeSession('grandchild')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('boom')

    expect(moveCalls.map((call) => `${call.sessionId}->${call.destinationDirectory}`)).toEqual([
      'child->/destination',
      'grandchild->/destination',
      'child->/source',
    ])
    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([])
    expect(removeWorktreeCalls).toEqual([])
    expect(refreshCalls).toEqual([])
    expect(folderScopesRewritten).toEqual([])
  })

  test('does not move the root when a descendant fails in session-only mode', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'child') throw new Error('boom')
    }

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: false,
    })).rejects.toThrow('boom')

    expect(moveCalls.map((call) => call.sessionId)).toEqual(['child'])
    // Only completed moves are rolled back; the failed child attempt left
    // nothing to restore, and the root — which moves last — was never sent.
  })

  test('rolls back a completed child when the root change transfer fails in session-only mode', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'root') throw new Error('root refused')
    }

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: false,
    })).rejects.toThrow('root refused')

    expect(moveCalls.map((call) => `${call.sessionId}->${call.destinationDirectory}`)).toEqual([
      'child->/destination',
      'root->/destination',
      'child->/source',
    ])
    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([])
  })

  test('reports an incomplete rollback explicitly when a moved child cannot return', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    let moveCount = 0
    moveSessionImplementation = async (session) => {
      moveCount += 1
      if (session.id === 'root') throw new Error('root failed')
      // The child moved out; its rollback move now fails too.
      if (moveCount > 2) throw new Error('rollback blocked')
    }

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('could not be fully rolled back')

    expect(removeWorktreeCalls).toEqual([])
  })

  test('skips rollback for a moved child that became busy in the destination', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'root') {
        setStatuses('/destination', { child: 'busy' })
        throw new Error('root failed')
      }
    }

    await expect(moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })).rejects.toThrow('could not be fully rolled back')
  })

  test('keeps the move successful when the post-move refresh fails', async () => {
    setStatuses('/source', { root: 'idle' })
    refreshImplementation = async () => {
      throw new Error('refresh down')
    }

    const result = await moveSessionTreeToExistingWorktree({
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      moveChanges: true,
    })

    expect(result).toBe('/destination')
  })
})

describe('moveSessionTreeToQuickWorktree (via requestSessionTreeMove)', () => {
  beforeEach(resetState)

  test('executes immediately with moveChanges=false when the source is clean', async () => {
    setStatuses('/source', { root: 'idle' })

    requestSessionTreeMove(makeQuickIntent())

    await waitFor(() => toastSuccesses.length > 0)
    expect(confirmationPending()).toBe(false)
    expect(createQuickWorktreeCalls).toHaveLength(1)
    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([])
    expect(toastSuccesses).toEqual(['move succeeded'])
  })

  test('waits for a dirty-source choice before preparing a quick worktree', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dir: 'M' }],
    })

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())

    expect(createQuickWorktreeCalls).toEqual([])
    expect(moveCalls).toEqual([])

    confirmSessionTreeMove(true)
    await waitFor(() => toastSuccesses.length > 0)

    expect(moveCalls.filter((call) => call.moveChanges)).toHaveLength(1)
    expect(folderScopesRewritten).toHaveLength(1)
  })

  test('cancels a pending dirty-source request without starting setup or move', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: 'M', working_dev: 'M' } as never],
    })

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    cancelSessionTreeMove()

    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(createQuickWorktreeCalls).toEqual([])
    expect(moveCalls).toEqual([])
    expect(toastErrors).toEqual([])
  })

  test('confirms session-only mode: no change transfer and fork migrations still run', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dir: 'M' }],
    })

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(false)
    await waitFor(() => toastSuccesses.length > 0)

    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([])
    expect(ensureWorktreeProjectCalls).toEqual([{ path: '/created-worktree', projectId: 'project-1' }])
    expect(folderScopesRewritten.map((entry) => entry.destination)).toEqual(['/created-worktree'])
  })

  test('does not replace an existing pending dirty-source confirmation', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dir: 'M' }],
    })

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    requestSessionTreeMove(makeQuickIntent())
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(createQuickWorktreeCalls).toEqual([])
  })

  test('moves a non-Git source without checking status or transferring source changes', async () => {
    setStatuses('/source', { root: 'idle' })
    isGitRepositoryImplementation = async () => false

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastSuccesses.length > 0)

    expect(getGitStatusImplementation).toBeDefined()
    expect(createQuickWorktreeCalls.map((call) => call.options)).toEqual([{}])
    expect(moveCalls.filter((call) => call.moveChanges)).toEqual([])
  })

  test('uses the source verification failure message when the repository check fails', async () => {
    setStatuses('/source', { root: 'idle' })
    isGitRepositoryImplementation = async () => {
      throw new Error('no git')
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors).toEqual([{ title: 'move failed', description: 'source verification failed' }])
    expect(moveCalls).toEqual([])
  })

  test('uses the source verification failure message when the status check fails', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => {
      throw new Error('status down')
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors).toEqual([{ title: 'move failed', description: 'source verification failed' }])
  })

  test('removes a newly created worktree when git-ready setup fails', async () => {
    setStatuses('/source', { root: 'idle' })
    waitForWorktreeGitReadyImplementation = async () => {
      throw new Error('setup failed')
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    expect(removeWorktreeCalls).toEqual([{ projectPath: '/repo', directory: '/created-worktree', deleteLocalBranch: true }])
    expect(moveCalls).toEqual([])
  })

  test('removes a newly created worktree when a session becomes busy before the first move', async () => {
    setStatuses('/source', { root: 'idle' })
    waitForWorktreeGitReadyImplementation = async () => {
      setStatuses('/source', { root: 'busy' })
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    expect(removeWorktreeCalls).toHaveLength(1)
    expect(moveCalls).toEqual([])
  })

  test('uses actionable apply guidance for explicit transfer failures', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dir: 'M' }],
    })
    moveSessionImplementation = async (session, _source, _destination, moveChanges) => {
      if (session.id === 'root' && moveChanges) {
        const error = new Error('Move session failed (400): Unable to apply your changes in the destination directory')
        ;(error as Error & { status?: number }).status = 400
        throw error
      }
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(true)
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors[0]?.description).toBe('apply changes failed')
    // The root move was rolled back, so the created worktree is safe to remove.
    expect(removeWorktreeCalls).toHaveLength(1)
  })

  test('retains other move errors when a 400 failure is not the apply-changes case', async () => {
    setStatuses('/source', { root: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'root') {
        const error = new Error('Move session failed (400): something else')
        ;(error as Error & { status?: number }).status = 400
        throw error
      }
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors[0]?.description).toContain('something else')
    expect(removeWorktreeCalls).toHaveLength(1)
  })

  test('keeps a newly created worktree when an ambiguous failure may have transferred the changes', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dev: 'M' } as never],
    })
    moveSessionImplementation = async (session, _source, _destination, moveChanges) => {
      if (session.id === 'root' && moveChanges) {
        // Real classifier path: the relay tags stream aborts as dispatched.
        throw markAmbiguousTransportFailure(new Error('stream aborted by host'))
      }
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(true)
    await waitFor(() => toastErrors.length > 0)

    expect(removeWorktreeCalls).toEqual([])
    expect(toastErrors[0]?.description).toBe('changes may be in destination')
    expect(refreshCalls).toEqual([['/source', '/created-worktree']])
  })

  test('removes a newly created worktree when the change transfer is definitely rejected', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dev: 'M' } as never],
    })
    moveSessionImplementation = async (session, _source, _destination, moveChanges) => {
      if (session.id === 'root' && moveChanges) {
        const error = new Error('Move session failed (409): destination refused')
        ;(error as Error & { status?: number }).status = 409
        throw error
      }
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(true)
    await waitFor(() => toastErrors.length > 0)

    expect(removeWorktreeCalls).toHaveLength(1)
    expect(toastErrors[0]?.description).toContain('destination refused')
  })

  test('removes a newly created worktree when an ambiguous failure carried no changes', async () => {
    setStatuses('/source', { root: 'idle' })
    moveSessionImplementation = async (session) => {
      if (session.id === 'root') {
        throw markAmbiguousTransportFailure(new Error('stream aborted by host'))
      }
    }

    requestSessionTreeMove(makeQuickIntent())
    await waitFor(() => toastErrors.length > 0)

    // The quick intent on a clean source moves without changes, so ambiguity
    // about the change transfer does not apply: rollback succeeded and the
    // empty worktree is removed.
    expect(removeWorktreeCalls).toHaveLength(1)
    expect(toastErrors[0]?.description).toContain('stream aborted by host')
  })

  test('reports the destination guidance for an ambiguous existing-worktree move', async () => {
    setStatuses('/source', { root: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dev: 'M' } as never],
    })
    moveSessionImplementation = async (session, _source, _destination, moveChanges) => {
      if (session.id === 'root' && moveChanges) {
        throw markAmbiguousTransportFailure(new Error('relay keepalive timeout'))
      }
    }

    requestSessionTreeMove({
      kind: 'existing',
      root: makeSession('root'),
      descendants: [],
      sourceDirectory: '/source',
      destination: makeWorktreeMetadata(),
      messages: makeMoveMessages(),
    })
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(true)
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors[0]?.description).toBe('changes may be in destination')
    expect(refreshCalls).toEqual([['/source', '/destination']])
    expect(removeWorktreeCalls).toEqual([])
  })

  test('keeps the destination guidance when rollback is also incomplete', async () => {
    setStatuses('/source', { root: 'idle', child: 'idle' })
    getGitStatusImplementation = async () => ({
      current: 'feature',
      isClean: false,
      files: [{ path: 'a.txt', index: '', working_dev: 'M' } as never],
    })
    let moveCount = 0
    moveSessionImplementation = async (session, _source, _destination, moveChanges) => {
      moveCount += 1
      if (session.id === 'root' && moveChanges) {
        throw markAmbiguousTransportFailure(new Error('stream aborted by host'))
      }
      if (moveCount > 1) throw new Error('rollback blocked')
    }

    requestSessionTreeMove({
      kind: 'quick',
      root: makeSession('root'),
      descendants: [makeSession('child')],
      sourceDirectory: '/source',
      messages: makeMoveMessages(),
    })
    await waitFor(() => confirmationPending())
    confirmSessionTreeMove(true)
    await waitFor(() => toastErrors.length > 0)

    expect(toastErrors[0]?.description).toContain('changes may be in destination')
    expect(toastErrors[0]?.description).toContain('could not be fully rolled back')
    expect(removeWorktreeCalls).toEqual([])
  })
})

afterEach(() => {
  resetState()
})
