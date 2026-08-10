import { describe, expect, test } from 'bun:test';

import { parsePendingRestartSnapshot } from './pendingRestart';

describe('pending restart response parsing', () => {
  test('parses pending count and active sessions', () => {
    expect(parsePendingRestartSnapshot({
      count: 2,
      reasons: ['agent update', 'plugin update'],
      changes: [
        { id: 1, reason: 'agent update', recordedAt: 10, scope: 'agents', entityId: 'reviewer' },
        { id: 2, reason: 'plugin update', recordedAt: 20, scope: 'plugins' },
        { id: 'bad', reason: 'invalid', recordedAt: 30 },
      ],
      affectedSessions: [
        { sessionId: 'busy', status: 'busy' },
        { sessionId: 'retrying', status: 'retry' },
        { sessionId: 'idle', status: 'idle' },
      ],
      isApplying: false,
    })).toEqual({
      count: 2,
      reasons: ['agent update', 'plugin update'],
      changes: [
        { id: 1, reason: 'agent update', recordedAt: 10, scope: 'agents', entityId: 'reviewer' },
        { id: 2, reason: 'plugin update', recordedAt: 20, scope: 'plugins' },
      ],
      affectedSessions: [
        { sessionId: 'busy', status: 'busy' },
        { sessionId: 'retrying', status: 'retry' },
      ],
      isApplying: false,
    });
  });

  test('rejects malformed snapshots', () => {
    expect(parsePendingRestartSnapshot({ count: '2', reasons: [] })).toBeNull();
    expect(parsePendingRestartSnapshot(null)).toBeNull();
  });
});
