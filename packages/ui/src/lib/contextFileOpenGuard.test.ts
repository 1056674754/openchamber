import { afterEach, describe, expect, test } from 'bun:test';

import type { FilesAPI } from '@/lib/api/types';
import { validateContextFileOpen } from '@/lib/contextFileOpenGuard';
import { configureRuntimeUrlResolver } from '@/lib/runtime-url';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureRuntimeUrlResolver({});
});

describe('validateContextFileOpen', () => {
  test('reads remote files through the configured local runtime origin', async () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'http://127.0.0.1:59387' });
    let requestedUrl = '';
    let localReadCalls = 0;
    const files: FilesAPI = {
      listDirectory: async (path) => ({ directory: path, entries: [] }),
      search: async () => [],
      createDirectory: async (path) => ({ success: true, path }),
      readFile: async () => {
        localReadCalls += 1;
        throw new Error('local filesystem must not be used for a remote instance');
      },
    };

    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response('# Project Agent Guidance\n', { status: 200 });
    }) as typeof fetch;

    const result = await validateContextFileOpen(files, '/root/novel_editor/AGENTS.md', '/api/remote/dev3');

    expect(result).toEqual({ ok: true });
    expect(localReadCalls).toBe(0);
    expect(requestedUrl).toBe('http://127.0.0.1:59387/api/remote/dev3/fs/read?path=%2Froot%2Fnovel_editor%2FAGENTS.md&allowOutsideWorkspace=true&optional=true');
  });
});
