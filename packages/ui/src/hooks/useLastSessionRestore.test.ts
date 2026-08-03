import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { findLastSessionRestoreTarget } from '@/sync/last-session-restore-target';

const session = (id: string, directory: string): Session => ({
  id,
  directory,
  title: id,
  time: { created: 1, updated: 1 },
} as Session);

describe('last session restore target', () => {
  test('selects only the session from the persisted server and directory', () => {
    const duplicateLocal = session('ses-1', '/repo/local');
    const duplicateRemote = session('ses-1', '/repo/remote');
    const serverIds = new Map<Session, string>([
      [duplicateLocal, 'default'],
      [duplicateRemote, 'remote-a'],
    ]);

    const result = findLastSessionRestoreTarget({
      persisted: {
        sessionId: 'ses-1',
        serverId: 'remote-a',
        directory: '/repo/remote',
      },
      sessions: [duplicateLocal, duplicateRemote],
      getServerId: (candidate) => serverIds.get(candidate) ?? null,
      getDirectory: (candidate) => candidate.directory ?? null,
    });

    expect(result).toBe(duplicateRemote);
  });

  test('does not restore when the authoritative directory no longer matches', () => {
    const moved = session('ses-1', '/repo/new');

    const result = findLastSessionRestoreTarget({
      persisted: {
        sessionId: 'ses-1',
        serverId: 'remote-a',
        directory: '/repo/old',
      },
      sessions: [moved],
      getServerId: () => 'remote-a',
      getDirectory: (candidate) => candidate.directory ?? null,
    });

    expect(result).toBeNull();
  });
});
