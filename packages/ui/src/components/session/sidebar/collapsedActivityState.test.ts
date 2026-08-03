import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { createSessionActivityKey } from '@/sync/session-activity-key';
import { getSessionNodesActivityState } from './collapsedActivityState';
import type { SessionNode } from './types';

const node = (id: string, directory: string, parentID?: string, children: SessionNode[] = []): SessionNode => ({
  session: { id, directory, parentID } as Session,
  children,
  worktree: null,
});

describe('collapsed sidebar activity', () => {
  test('does not leak an active duplicate session ID across instances', () => {
    const nodes = [node('duplicate', '/repo')];
    const activeSessionKeys = new Set([createSessionActivityKey('remote', '/repo', 'duplicate')]);

    expect(getSessionNodesActivityState(nodes, {
      serverId: 'default',
      fallbackDirectory: '/repo',
      activeSessionKeys,
      unreadSessionIds: new Set(),
      includeUnreadSubtasks: true,
    })).toBeNull();
  });

  test('prioritizes scoped active descendants over unread roots', () => {
    const nodes = [node('unread', '/repo'), node('root', '/repo', undefined, [node('active-child', '/repo', 'root')])];
    expect(getSessionNodesActivityState(nodes, {
      serverId: 'default',
      fallbackDirectory: '/repo',
      activeSessionKeys: new Set([createSessionActivityKey('default', '/repo', 'active-child')]),
      unreadSessionIds: new Set(['unread']),
      includeUnreadSubtasks: false,
    })).toBe('active');
  });

  test('does not apply local unread state to a remote instance', () => {
    expect(getSessionNodesActivityState([node('unread', '/repo')], {
      serverId: 'remote',
      fallbackDirectory: '/repo',
      activeSessionKeys: new Set(),
      unreadSessionIds: new Set(['unread']),
      includeUnreadSubtasks: true,
    })).toBeNull();
  });
});
