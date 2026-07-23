import { describe, expect, test } from 'bun:test';

import { countDockBadgeChats } from './desktop-dock-badge';

describe('desktop dock unread badge', () => {
  test('counts each unread root chat once across duplicate sidebar projections', () => {
    expect(countDockBadgeChats({
      sessions: [
        { id: 'root-a' },
        { id: 'root-a' },
        { id: 'root-b' },
      ],
      unseenCount: { 'root-a': 3, 'root-b': 1 },
      notifyOnSubtasks: true,
    })).toBe(2);
  });

  test('rolls unread descendants up only when subtask notifications are enabled', () => {
    const sessions = [
      { id: 'root' },
      { id: 'child', parentID: 'root' },
      { id: 'grandchild', parentID: 'child' },
    ];

    expect(countDockBadgeChats({
      sessions,
      unseenCount: { grandchild: 1 },
      notifyOnSubtasks: true,
    })).toBe(1);
    expect(countDockBadgeChats({
      sessions,
      unseenCount: { grandchild: 1 },
      notifyOnSubtasks: false,
    })).toBe(0);
  });
});
