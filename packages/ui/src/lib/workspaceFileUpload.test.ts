import { describe, expect, test } from 'bun:test';

import { uploadWorkspaceFile } from './workspaceFileUpload';

describe('uploadWorkspaceFile', () => {
  test('sends binary data with explicit remote workspace authority', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const file = new Blob([new Uint8Array([0, 1, 255])]);
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ success: true, path: '/root/project/image.bin' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof import('@/lib/runtime-fetch').runtimeFetch;

    const result = await uploadWorkspaceFile({
      serverBaseUrl: '/api/remote/dev3',
      directory: '/root/project',
      path: '/root/project/image.bin',
      file,
      fetcher,
    });

    expect(result).toEqual({ success: true, path: '/root/project/image.bin' });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toContain('/api/remote/dev3/fs/upload?');
    expect(calls[0].input).toContain('directory=%2Froot%2Fproject');
    expect(calls[0].init?.body).toBe(file);
    expect(new Headers(calls[0].init?.headers).get('Content-Type')).toBe('application/octet-stream');
  });

  test('maps conflict responses without losing the raw status', async () => {
    const fetcher = (async () => new Response(JSON.stringify({
      error: 'File already exists',
      reason: 'already-exists',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof import('@/lib/runtime-fetch').runtimeFetch;

    let caught: unknown;
    try {
      await uploadWorkspaceFile({
        serverBaseUrl: '',
        directory: '/repo',
        path: '/repo/a.txt',
        file: new Blob(['a']),
        fetcher,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { reason?: unknown }).reason).toBe('already-exists');
    expect((caught as { status?: unknown }).status).toBe(409);
  });

  test('refuses a request with no owning directory before fetch', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return new Response();
    }) as typeof import('@/lib/runtime-fetch').runtimeFetch;

    await expect(uploadWorkspaceFile({
      serverBaseUrl: '',
      directory: '',
      path: '/repo/a.txt',
      file: new Blob(['a']),
      fetcher,
    })).rejects.toThrow('Owning directory is required');
    expect(called).toBe(false);
  });
});
