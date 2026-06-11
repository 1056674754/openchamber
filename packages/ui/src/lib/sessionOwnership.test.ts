import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

mock.module('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: ({ baseUrl }: { baseUrl: string }) => ({ baseUrl }),
}));

const { serverRegistry } = await import('@/lib/opencode/server-registry');
const { getProjectIdForSession, resolveProjectIdViaPathPrefix } = await import('./sessionOwnership');

const PROJECT_PATH = '/Users/song/dev_ai/openchamber-merge-v1.11.0';

const makeSession = (id: string, directory = PROJECT_PATH): Session => ({
  id,
  directory,
  time: { created: 1, updated: 1 },
} as unknown as Session);

const localProject = {
  id: 'project-local',
  normalizedPath: PROJECT_PATH,
};

const remoteProject = {
  id: 'project-dev1',
  normalizedPath: PROJECT_PATH,
  serverId: 'Dev1',
};

describe('sessionOwnership', () => {
  beforeEach(() => {
    serverRegistry.forgetSession('local-session');
    serverRegistry.forgetSession('remote-session');
    serverRegistry.forgetSession('stale-bound-session');
    serverRegistry.clearSessionServerIndexDebugEntries();
  });

  test('prefers the local project for an unindexed session when a remote project has the same path', () => {
    expect(resolveProjectIdViaPathPrefix(
      makeSession('local-session'),
      [remoteProject, localProject],
      new Map(),
    )).toBe(localProject.id);
  });

  test('does not assign an unindexed session to a remote-only path match', () => {
    expect(resolveProjectIdViaPathPrefix(
      makeSession('local-session'),
      [remoteProject],
      new Map(),
    )).toBeNull();
  });

  test('uses the indexed remote server for remote sessions with colliding paths', () => {
    serverRegistry.indexSession('remote-session', 'Dev1');

    expect(resolveProjectIdViaPathPrefix(
      makeSession('remote-session'),
      [localProject, remoteProject],
      new Map(),
    )).toBe(remoteProject.id);
  });

  test('ignores a stale remote binding for an unindexed local session', () => {
    expect(getProjectIdForSession(
      makeSession('stale-bound-session'),
      [localProject, remoteProject],
      new Map(),
      new Map([['stale-bound-session', remoteProject.id]]),
    )).toBe(localProject.id);
  });

  test('drops a stale remote binding when no default project owns the local session', () => {
    expect(getProjectIdForSession(
      makeSession('stale-bound-session'),
      [remoteProject],
      new Map(),
      new Map([['stale-bound-session', remoteProject.id]]),
    )).toBeNull();
  });
});
