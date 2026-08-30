import { describe, expect, test } from 'bun:test';

import { CHAT_DRAFT_PROJECT_ID } from '@/lib/chatDirectories';
import { resolveChatSearchDirectory } from './useChatSearchDirectory';

const projects = [
  { id: 'project-a', path: '/workspace/project-a' },
  { id: 'project-b', path: '/workspace/project-b' },
];

describe('resolveChatSearchDirectory', () => {
  test('uses the current Session authority before global project state', () => {
    expect(resolveChatSearchDirectory({
      currentSessionId: 'ses-1',
      sessionDirectory: '/remote/session',
      projects,
      activeProjectId: 'project-a',
      fallbackDirectory: '/workspace/project-a',
    })).toBe('/remote/session');
  });

  test('uses a prepared Chat directory and rejects stale project overrides', () => {
    expect(resolveChatSearchDirectory({
      draft: {
        open: true,
        target: 'chat',
        selectedProjectId: CHAT_DRAFT_PROJECT_ID,
        preparedChatDirectory: '/remote/home/.config/openchamber/chats/chat-1',
        directoryOverride: '/workspace/project-a',
        chatServerId: 'remote-a',
      },
      projects,
      activeProjectId: 'project-a',
      fallbackDirectory: '/workspace/project-a',
    })).toBe('/remote/home/.config/openchamber/chats/chat-1');
  });

  test('fails closed for an unprepared remote Chat draft', () => {
    expect(resolveChatSearchDirectory({
      draft: {
        open: true,
        target: 'chat',
        selectedProjectId: CHAT_DRAFT_PROJECT_ID,
        directoryOverride: '/workspace/project-a',
        chatServerId: 'remote-a',
      },
      projects,
      activeProjectId: 'project-a',
      fallbackDirectory: '/workspace/project-a',
      homeDirectory: '/local/home',
    })).toBeUndefined();
  });

  test('derives the managed root only for a local Chat draft', () => {
    expect(resolveChatSearchDirectory({
      draft: { open: true, target: 'chat', chatServerId: 'default' },
      projects,
      fallbackDirectory: '/workspace/project-a',
      homeDirectory: '/Users/tester',
    })).toBe('/Users/tester/.config/openchamber/chats');
  });

  test('keeps ordinary project drafts scoped to their selected project', () => {
    expect(resolveChatSearchDirectory({
      draft: { open: true, target: 'project', selectedProjectId: 'project-b' },
      projects,
      activeProjectId: 'project-a',
      fallbackDirectory: '/workspace/project-a',
    })).toBe('/workspace/project-b');
  });
});
