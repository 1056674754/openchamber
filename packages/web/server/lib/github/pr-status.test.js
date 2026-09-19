import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';

const listMock = mock(async () => ({ data: [] }));

mock.module('../git/index.js', () => ({
  getRemotes: async () => [],
  getTrackingBranch: async () => null,
}));

mock.module('./repo/index.js', () => ({
  resolveGitHubRepoFromDirectory: async () => null,
}));

mock.module('./rate-limit.js', () => ({
  noteIfGitHubRateLimit: () => {},
}));

const { findBranchPrCandidates, invalidateRepoPullsCache } = await import('./pr-status.js');

const openPr = {
  number: 15,
  state: 'open',
  head: {
    ref: 'feature',
    label: 'acme:feature',
    user: { login: 'acme' },
    repo: { owner: { login: 'acme' }, name: 'app' },
  },
};

const mergedPr = {
  number: 12,
  state: 'closed',
  merged_at: '2026-01-01T00:00:00Z',
  head: {
    ref: 'feature',
    label: 'acme:feature',
    user: { login: 'acme' },
    repo: { owner: { login: 'acme' }, name: 'app' },
  },
};

const olderMergedPr = {
  ...mergedPr,
  number: 7,
  merged_at: '2025-11-01T00:00:00Z',
};

const call = (overrides = {}) => findBranchPrCandidates({
  octokit: { rest: { pulls: { list: listMock } } },
  target: { repo: { owner: 'acme', repo: 'app' }, remoteName: 'origin' },
  branch: 'feature',
  sourceCandidates: [{ repo: { owner: 'acme', repo: 'app' } }],
  force: true,
  includeHistory: true,
  ...overrides,
});

describe('findBranchPrCandidates', () => {
  beforeEach(() => {
    listMock.mockReset();
    invalidateRepoPullsCache('acme', 'app');
  });

  afterEach(() => {
    setSystemTime();
  });

  test('prefers an open PR without spending a history lookup', async () => {
    listMock.mockImplementation(async ({ state }) => (
      state === 'open' ? { data: [openPr] } : { data: [mergedPr] }
    ));

    const { open, historical } = await call();

    expect(open?.number).toBe(15);
    expect(historical).toBeNull();
    expect(listMock.mock.calls.every((entry) => entry[0]?.state === 'open')).toBe(true);
  });

  test('finds an open PR through the precise head query after an incomplete list', async () => {
    listMock.mockImplementation(async ({ head }) => (
      head
        ? { data: [mergedPr, openPr] }
        : { data: new Array(100).fill(null).map((_, index) => ({ number: index, state: 'open', head: { ref: 'other' } })) }
    ));

    const { open, historical } = await call();

    expect(open?.number).toBe(15);
    expect(historical).toBeNull();
  });

  test('returns the newest historical PR when no open PR exists', async () => {
    listMock.mockImplementation(async ({ head }) => (
      head ? { data: [olderMergedPr, mergedPr] } : { data: [] }
    ));

    const { open, historical } = await call();

    expect(open).toBeNull();
    expect(historical?.number).toBe(12);
  });

  test('does not query history for a secondary target', async () => {
    listMock.mockImplementation(async ({ head }) => (
      head ? { data: [mergedPr] } : { data: [] }
    ));

    const { open, historical } = await call({ includeHistory: false });

    expect(open).toBeNull();
    expect(historical).toBeNull();
    expect(listMock.mock.calls).toHaveLength(1);
    expect(listMock.mock.calls[0]?.[0]?.state).toBe('open');
  });

  test('reuses a cached historical result on normal discovery polls', async () => {
    listMock.mockImplementation(async ({ head }) => (
      head ? { data: [mergedPr] } : { data: [] }
    ));

    await call();
    const callsAfterFirst = listMock.mock.calls.length;
    const { historical } = await call({ force: false });

    expect(historical?.number).toBe(12);
    expect(listMock.mock.calls.length).toBe(callsAfterFirst);
  });

  test('expires an absent-history result sooner than a found result', async () => {
    const startedAt = Date.now();
    listMock.mockImplementation(async () => ({ data: [] }));

    await call();
    const callsAfterFirst = listMock.mock.calls.length;
    setSystemTime(new Date(startedAt + 30 * 60 * 1000));
    await call({ force: false });

    expect(listMock.mock.calls.length).toBeGreaterThan(callsAfterFirst + 1);
    expect(listMock.mock.calls.some((entry) => entry[0]?.state === 'all')).toBe(true);
  });
});
