import { beforeEach, describe, expect, mock, test } from 'bun:test';

const requests: Array<{ url: string; init?: RequestInit }> = [];

mock.module('@/lib/runtime-switch', () => ({ getRuntimeKey: () => 'runtime-a' }));
mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    get: (serverId: string) => serverId === 'remote-a' ? { config: { baseUrl: '/api/remote/remote-a' } } : undefined,
  },
}));
mock.module('@/lib/remote-instances/registry', () => ({ registerRemoteInstanceProxy: () => null }));
mock.module('@/lib/runtime-fetch', () => ({
  runtimeFetch: mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    requests.push({ url, init });
    if (url.endsWith('/fs/home')) return Response.json({ home: url.includes('remote-a') ? '/home/remote' : '/Users/local' });
    return Response.json({ success: true });
  }),
}));

const {
  createChatDirectory,
  deleteChatDirectory,
  getChatsRootFromDirectory,
  isChatDirectoryForHome,
  isChatDirectoryPath,
} = await import('./chatDirectories');

beforeEach(() => { requests.length = 0; });

describe('managed projectless chat directories', () => {
  test('creates a date-scoped local directory through the local server', async () => {
    const directory = await createChatDirectory({ now: new Date(2026, 7, 21, 12) });
    expect(directory.startsWith('/Users/local/.config/openchamber/chats/2026-08-21/session-')).toBe(true);
    expect(requests.map((request) => request.url)).toEqual(['/api/fs/home', '/api/fs/mkdir']);
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({ path: directory, allowOutsideWorkspace: true });
  });

  test('keeps remote home, mkdir, and delete on the explicit instance', async () => {
    const directory = await createChatDirectory({ serverId: 'remote-a', now: new Date(2026, 7, 22, 12) });
    await deleteChatDirectory(directory, 'remote-a');

    expect(directory.startsWith('/home/remote/.config/openchamber/chats/2026-08-22/session-')).toBe(true);
    expect(requests.map((request) => request.url)).toEqual([
      '/api/remote/remote-a/fs/home',
      '/api/remote/remote-a/fs/mkdir',
      '/api/remote/remote-a/fs/delete',
    ]);
  });

  test('recognizes managed descendants and refuses to delete project paths', async () => {
    expect(isChatDirectoryForHome('/Users/local/.config/openchamber/chats/2026-08-21/session-a', '/Users/local')).toBe(true);
    expect(isChatDirectoryPath('/remote/home/.config/openchamber/chats/2026-08-21/session-a')).toBe(true);
    expect(getChatsRootFromDirectory('/remote/home/.config/openchamber/chats/2026-08-21/session-a')).toBe('/remote/home/.config/openchamber/chats');

    await deleteChatDirectory('/Users/local/project');
    expect(requests).toEqual([]);
  });
});
