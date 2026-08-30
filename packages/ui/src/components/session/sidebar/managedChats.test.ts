import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import {
  deriveInstanceManagedChatsSources,
  deriveManagedChatsSource,
} from './managedChats';

const session = (id: string, directory: string, archived = false): Session => ({
  id,
  directory,
  title: id,
  time: { created: 1, updated: 1, ...(archived ? { archived: 2 } : {}) },
} as unknown as Session);

describe('managed Chats sidebar source', () => {
  test('uses one root and retains per-session folder lookup scopes', () => {
    const source = deriveManagedChatsSource([
      session('a', '/Users/tester/.config/openchamber/chats/2026-08-30/session-a'),
      session('b', '/Users/tester/.config/openchamber/chats/2026-08-31/session-b'),
      session('project', '/workspace/project'),
    ], '/Users/tester');

    expect(source?.root).toBe('/Users/tester/.config/openchamber/chats');
    expect(source?.sessions.map((item) => item.id)).toEqual(['a', 'b']);
    expect(source?.rootNodes.map((item) => item.session.id)).toEqual(['a', 'b']);
    expect(source?.folderScopes.map((item) => item.directory)).toEqual([
      '/Users/tester/.config/openchamber/chats',
      '/Users/tester/.config/openchamber/chats/2026-08-30/session-a',
      '/Users/tester/.config/openchamber/chats/2026-08-31/session-b',
    ]);
  });

  test('infers a remote root from Session paths and excludes archived Chats', () => {
    const source = deriveManagedChatsSource([
      session('remote', '/home/remote/.config/openchamber/chats/2026-08-30/session-a'),
      session('archived', '/home/remote/.config/openchamber/chats/2026-08-30/session-b', true),
    ], '/Users/local');

    expect(source?.root).toBe('/home/remote/.config/openchamber/chats');
    expect(source?.sessions.map((item) => item.id)).toEqual(['remote']);
  });

  test('builds parent-child trees and keeps instance roots separate', () => {
    const parent = session('parent', '/Users/tester/.config/openchamber/chats/2026-08-30/session-a');
    const child = {
      ...session('child', '/Users/tester/.config/openchamber/chats/2026-08-30/session-a'),
      parentID: 'parent',
    } as Session;
    const remote = session('remote', '/home/remote/.config/openchamber/chats/2026-08-30/session-b');
    const sources = deriveInstanceManagedChatsSources(
      [parent, child, remote],
      (item) => item.id === 'remote' ? 'dev3' : 'default',
      '/Users/tester',
    );

    expect(sources.map((source) => source.serverId)).toEqual(['default', 'dev3']);
    expect(sources[0]?.rootNodes.map((node) => node.session.id)).toEqual(['parent']);
    expect(sources[0]?.rootNodes[0]?.children.map((node) => node.session.id)).toEqual(['child']);
    expect(sources[1]?.root).toBe('/home/remote/.config/openchamber/chats');
  });
});
