import { describe, expect, test } from 'bun:test';

import { probeWorkspaceDirectoryAvailability } from './directoryAvailability';

const fetcherOf = (response: Response | Error) => (async () => {
  if (response instanceof Error) throw response;
  return response;
}) as typeof import('@/lib/runtime-fetch').runtimeFetch;

describe('probeWorkspaceDirectoryAvailability', () => {
  test('reports a successful explicit stat as available', async () => {
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '/repo/worktree',
      serverBaseUrl: '/api/remote/dev3',
      fetcher: fetcherOf(new Response('{}', { status: 200 })),
    })).toBe('available');
  });

  test('reports only confirmed missing responses as missing', async () => {
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '/repo/deleted',
      serverBaseUrl: '',
      fetcher: fetcherOf(new Response(JSON.stringify({ reason: 'not-found' }), { status: 404 })),
    })).toBe('missing');
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '/repo/deleted',
      serverBaseUrl: '',
      fetcher: fetcherOf(new Response(JSON.stringify({ error: 'ENOENT: no such file or directory' }), { status: 400 })),
    })).toBe('missing');
  });

  test('keeps offline, permission, and invalid probes unknown', async () => {
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '/repo/worktree',
      serverBaseUrl: '',
      fetcher: fetcherOf(new Error('offline')),
    })).toBe('unknown');
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '/repo/worktree',
      serverBaseUrl: '',
      fetcher: fetcherOf(new Response('{}', { status: 403 })),
    })).toBe('unknown');
    expect(await probeWorkspaceDirectoryAvailability({
      directory: '',
      serverBaseUrl: '',
      fetcher: fetcherOf(new Response('{}', { status: 404 })),
    })).toBe('unknown');
  });
});
