import { afterEach, describe, expect, test } from 'bun:test';

import { serverRegistry } from '@/lib/opencode/server-registry';

import {
  resolveProjectContextApiBasePath,
  resolveProjectContextId,
} from './projectContextAuthority';

const REMOTE = 'project-context-dev3';

afterEach(() => {
  serverRegistry.unregister(REMOTE);
});

describe('project context request authority', () => {
  test('derives stable storage ids from paths rather than mutable project ids', () => {
    const first = resolveProjectContextId({ id: 'old-id', path: '/workspace/app' });
    const second = resolveProjectContextId({ id: 'new-id', path: '/workspace/app' });

    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });

  test('routes the same path to the explicitly selected remote server', () => {
    const local = resolveProjectContextApiBasePath({ id: 'local', path: '/workspace/app' });
    const remote = resolveProjectContextApiBasePath({
      id: 'remote',
      path: '/workspace/app',
      serverId: REMOTE,
    });

    expect(local.startsWith('/api/project-context/')).toBe(true);
    expect(remote.startsWith(`/api/remote/${REMOTE}/project-context/`)).toBe(true);
    expect(remote).not.toBe(local);
  });
});
