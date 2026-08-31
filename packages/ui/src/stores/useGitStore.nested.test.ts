import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { useGitStore } from '@/stores/useGitStore'

class TestGitDirectoriesUnsupportedError extends Error {
  constructor() {
    super('Nested git repository discovery is not supported by this runtime')
    this.name = 'GitDirectoriesUnsupportedError'
  }
}

const listGitDirectoriesControl: { impl: (root: string) => Promise<string[]> } = {
  impl: async () => {
    throw new Error('network unavailable')
  },
}

mock.module('@/lib/gitApiHttp', () => ({
  GitDirectoriesUnsupportedError: TestGitDirectoriesUnsupportedError,
  listGitDirectories: (root: string) => listGitDirectoriesControl.impl(root),
}))

describe('useGitStore nested repository discovery', () => {
  beforeEach(() => {
    listGitDirectoriesControl.impl = async () => {
      throw new Error('network unavailable')
    }
    useGitStore.setState({
      nestedReposByRoot: new Map(),
      nestedRepoSelection: new Map(),
      staleClearedSelections: new Map(),
    })
  })

  test('selects a nested repo per root', () => {
    useGitStore.getState().selectNestedRepo('/root-a', '/root-a/repo-one')

    expect(useGitStore.getState().nestedRepoSelection.get('/root-a')).toBe('/root-a/repo-one')
  })

  test('keeps selections isolated per root', () => {
    useGitStore.getState().selectNestedRepo('/root-a', '/root-a/one')
    useGitStore.getState().selectNestedRepo('/root-b', '/root-b/two')

    expect(useGitStore.getState().nestedRepoSelection.get('/root-a')).toBe('/root-a/one')
    expect(useGitStore.getState().nestedRepoSelection.get('/root-b')).toBe('/root-b/two')
  })

  test('clears only the given root selection', () => {
    useGitStore.getState().selectNestedRepo('/root-a', '/root-a/one')
    useGitStore.getState().selectNestedRepo('/root-b', '/root-b/two')

    useGitStore.getState().clearNestedRepoSelection('/root-a')

    expect(useGitStore.getState().nestedRepoSelection.has('/root-a')).toBe(false)
    expect(useGitStore.getState().nestedRepoSelection.get('/root-b')).toBe('/root-b/two')
  })

  test('remembers a stale-cleared repository so auto-select can skip it', () => {
    useGitStore.getState().selectNestedRepo('/root-a', '/root-a/one')
    useGitStore.getState().selectNestedRepo('/root-b', '/root-b/two')

    useGitStore.getState().clearNestedRepoSelection('/root-a')
    useGitStore.getState().clearNestedRepoSelection('/root-b')
    useGitStore.getState().clearNestedRepoSelection('/root-b')

    const clearedA = useGitStore.getState().staleClearedSelections.get('/root-a')
    const clearedB = useGitStore.getState().staleClearedSelections.get('/root-b')
    expect(clearedA).toEqual(new Set(['/root-a/one']))
    // Repeated clears of the same path stay a set, not an ever-growing list.
    expect(clearedB).toEqual(new Set(['/root-b/two']))
  })

  test('marks discovery failure as a failed marker, not an empty success', async () => {
    await useGitStore.getState().ensureNestedRepos('/root-a')

    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toBeNull()
  })

  test('marks a 501 runtime as unsupported instead of failed', async () => {
    listGitDirectoriesControl.impl = async () => {
      throw new TestGitDirectoriesUnsupportedError()
    }

    await useGitStore.getState().ensureNestedRepos('/root-a')

    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toBe('unsupported')
  })

  test('unsupported does not clobber a previous successful discovery', async () => {
    listGitDirectoriesControl.impl = async () => ['/root-a/one']
    await useGitStore.getState().ensureNestedRepos('/root-a')

    listGitDirectoriesControl.impl = async () => {
      throw new TestGitDirectoriesUnsupportedError()
    }
    await useGitStore.getState().ensureNestedRepos('/root-a', { force: true })

    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toEqual(['/root-a/one'])
  })

  test('dedupes concurrent discovery runs for the same root', async () => {
    const gate: { resolve: ((repos: string[]) => void) | null } = { resolve: null }
    const captureResolve = (resolve: (repos: string[]) => void): void => {
      gate.resolve = resolve
    }
    listGitDirectoriesControl.impl = () => new Promise(captureResolve)
    const first = useGitStore.getState().ensureNestedRepos('/root-a')
    const second = useGitStore.getState().ensureNestedRepos('/root-a')

    expect(useGitStore.getState().nestedReposByRoot.has('/root-a')).toBe(false)
    gate.resolve?.(['/root-a/one'])
    await Promise.all([first, second])

    // Both callers shared one discovery run; its result committed once.
    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toEqual(['/root-a/one'])
  })

  test('forced refresh bypasses the cached discovery result', async () => {
    listGitDirectoriesControl.impl = async () => []
    await useGitStore.getState().ensureNestedRepos('/root-a')
    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toEqual([])

    listGitDirectoriesControl.impl = async () => ['/root-a/one']
    // Without force, the cached (even empty) answer is served.
    await useGitStore.getState().ensureNestedRepos('/root-a')
    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toEqual([])

    await useGitStore.getState().ensureNestedRepos('/root-a', { force: true })
    expect(useGitStore.getState().nestedReposByRoot.get('/root-a')).toEqual(['/root-a/one'])
  })
})
