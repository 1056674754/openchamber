import { afterEach, describe, expect, test } from 'bun:test';

import type { FilesAPI } from '@/lib/api/types';
import { statFilesViewPath } from '@/lib/filesViewFileAccess';
import { configureRuntimeUrlResolver } from '@/lib/runtime-url';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  configureRuntimeUrlResolver({});
});

describe('statFilesViewPath', () => {
  test('uses the remote filesystem proxy instead of the local runtime API', async () => {
    configureRuntimeUrlResolver({ apiBaseUrl: 'http://127.0.0.1:59387' });
    let localStatCalls = 0;
    let requestedUrl = '';
    const files: Pick<FilesAPI, 'statFile'> = {
      statFile: async () => {
        localStatCalls += 1;
        throw new Error('local filesystem must not be used for a remote instance');
      },
    };

    globalThis.fetch = (async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        path: '/root/novel_editor/AGENTS.md',
        isFile: true,
        size: 321,
        mtimeMs: 456,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const result = await statFilesViewPath(
      files,
      '/root/novel_editor/AGENTS.md',
      { directory: '/root/novel_editor' },
      '/api/remote/dev3',
    );

    expect(localStatCalls).toBe(0);
    expect(requestedUrl).toBe('http://127.0.0.1:59387/api/remote/dev3/fs/stat?path=%2Froot%2Fnovel_editor%2FAGENTS.md&directory=%2Froot%2Fnovel_editor');
    expect(result).toEqual({
      path: '/root/novel_editor/AGENTS.md',
      isFile: true,
      size: 321,
      mtimeMs: 456,
    });
  });
});
