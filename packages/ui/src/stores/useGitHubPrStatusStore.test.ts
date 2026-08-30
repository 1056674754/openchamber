import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { GitHubPullRequestStatus, RuntimeAPIs } from '@/lib/api/types';

mock.module('./utils/safeStorage', () => ({
  createDeferredSafeJSONStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const { getGitHubPrStatusKey, useGitHubPrStatusStore } = await import('./useGitHubPrStatusStore');

const merged: GitHubPullRequestStatus = {
  connected: true,
  pr: {
    number: 12,
    title: 'old',
    url: 'https://github.com/acme/app/pull/12',
    state: 'merged',
    draft: false,
    base: 'main',
    head: 'feature',
  },
};

const open: GitHubPullRequestStatus = {
  connected: true,
  pr: {
    number: 15,
    title: 'new',
    url: 'https://github.com/acme/app/pull/15',
    state: 'open',
    draft: false,
    base: 'main',
    head: 'feature',
  },
};

describe('GitHub PR historical status', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let intervalCallbacks: Array<() => void> = [];

  beforeEach(() => {
    intervalCallbacks = [];
    const setIntervalStub = ((handler: TimerHandler) => {
      if (typeof handler === 'function') {
        intervalCallbacks.push(handler as () => void);
      }
      return 1;
    }) as unknown as typeof setInterval;
    const setTimeoutStub = (() => 1) as unknown as typeof setTimeout;
    const clearStub = (() => undefined) as typeof clearInterval;
    Object.assign(globalThis, {
      window: {
        setInterval: setIntervalStub,
        setTimeout: setTimeoutStub,
        clearInterval: clearStub,
        clearTimeout: clearStub,
      },
      document: { visibilityState: 'visible' },
    });
    useGitHubPrStatusStore.setState({
      entries: {},
      activeRequestCount: 0,
      totalRequestCount: 0,
    });
  });

  afterEach(() => {
    useGitHubPrStatusStore.setState({ entries: {}, activeRequestCount: 0 });
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
  });

  test('watcher discovery replaces merged history with a newer open PR', async () => {
    const responses = [merged, open];
    let requestCount = 0;
    const github = {
      prStatus: mock(async () => {
        requestCount += 1;
        return responses.shift() ?? open;
      }),
    } as unknown as RuntimeAPIs['github'];
    const key = getGitHubPrStatusKey('/repo', 'feature', 'origin');
    const store = useGitHubPrStatusStore.getState();
    store.ensureEntry(key);
    store.setParams(key, {
      directory: '/repo',
      branch: 'feature',
      remoteName: 'origin',
      canShow: true,
      github,
      githubAuthChecked: true,
      githubConnected: true,
    });
    store.startWatching(key);

    for (let attempt = 0; attempt < 50 && useGitHubPrStatusStore.getState().entries[key]?.status?.pr?.number !== 12; attempt += 1) {
      await Promise.resolve();
    }
    expect(useGitHubPrStatusStore.getState().entries[key]?.status?.pr?.number).toBe(12);
    expect(intervalCallbacks).toHaveLength(1);

    intervalCallbacks[0]?.();
    for (let attempt = 0; attempt < 50 && useGitHubPrStatusStore.getState().entries[key]?.status?.pr?.number !== 15; attempt += 1) {
      await Promise.resolve();
    }

    expect(requestCount).toBe(2);
    expect(useGitHubPrStatusStore.getState().entries[key]?.status?.pr?.state).toBe('open');
    useGitHubPrStatusStore.getState().stopWatching(key);
  });

  test('persisted merged history resets its discovery timestamp on hydrate', () => {
    const key = getGitHubPrStatusKey('/repo', 'feature', 'origin');
    const merge = useGitHubPrStatusStore.persist.getOptions().merge;
    const hydrated = merge?.(
      {
        entries: {
          [key]: {
            status: merged,
            isInitialStatusResolved: true,
            lastRefreshAt: 2_000,
            lastDiscoveryPollAt: 2_000,
            identity: { directory: '/repo', branch: 'feature', remoteName: 'origin' },
            resolvedRemoteName: 'origin',
          },
        },
      },
      useGitHubPrStatusStore.getState(),
    ) as ReturnType<typeof useGitHubPrStatusStore.getState> | undefined;

    expect(hydrated?.entries[key]?.status?.pr?.number).toBe(12);
    expect(hydrated?.entries[key]?.lastDiscoveryPollAt).toBe(0);
  });
});
