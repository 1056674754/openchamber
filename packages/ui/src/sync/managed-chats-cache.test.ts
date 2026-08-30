import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

const storage = new Map<string, string>();
const indexed: Array<{ sessionId: string; serverId: string }> = [];
const serverBySession = new Map<string, string>();

mock.module('@/lib/runtime-switch', () => ({ getRuntimeKey: () => 'runtime-a' }));
mock.module('@/lib/desktop', () => ({ isVSCodeRuntime: () => false }));
mock.module('@/stores/utils/safeStorage', () => ({
  getSafeStorage: () => ({
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  }),
}));
mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    get: () => undefined,
    getServerForSession: (sessionId: string) => serverBySession.get(sessionId),
    indexSession: (sessionId: string, serverId: string) => indexed.push({ sessionId, serverId }),
  },
}));

const { persistManagedChatSessions, readManagedChatSessions } = await import('./managed-chats-cache');

const chat = (id: string, directory = '/home/user/.config/openchamber/chats/2026-08-30/session-a'): Session => ({
  id,
  directory,
  title: id,
  time: { created: 1, updated: 1 },
} as unknown as Session);

beforeEach(() => {
  storage.clear();
  indexed.length = 0;
  serverBySession.clear();
});

describe('managed Chats cold-start cache', () => {
  test('persists only managed Chats and restores remote ownership', () => {
    serverBySession.set('chat-1', 'remote-a');
    persistManagedChatSessions([chat('chat-1'), chat('project-1', '/workspace/project')]);

    const restored = readManagedChatSessions();

    expect(restored.map((session) => session.id)).toEqual(['chat-1']);
    expect(indexed).toEqual([{ sessionId: 'chat-1', serverId: 'remote-a' }]);
  });

  test('fails closed on malformed or cross-runtime data', () => {
    persistManagedChatSessions([chat('chat-1')]);
    storage.set([...storage.keys()][0], '{bad');
    expect(readManagedChatSessions()).toEqual([]);
    expect(readManagedChatSessions('runtime-b')).toEqual([]);
  });
});
