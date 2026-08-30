import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { cleanupBtwBeforeSessionRemoval } from './sessionBtwLifecycle';

const session = (id: string, openchamber: Record<string, unknown>): Session => ({
  id,
  metadata: { openchamber },
} as unknown as Session);

describe('btw linked-session cleanup', () => {
  test('removing a fork unlinks only that fork from its parent', async () => {
    let parentMetadata: Record<string, unknown> = { openchamber: { btwSessionID: 'fork-1', other: true } };
    let deleted = false;

    await cleanupBtwBeforeSessionRemoval('fork-1', {
      getSession: async () => session('fork-1', { kind: 'btw', originalSessionID: 'parent-1' }),
      patchMetadata: async (_id, transform) => { parentMetadata = transform(parentMetadata); },
      deleteTemporarySession: async () => { deleted = true; },
    });

    expect(parentMetadata).toEqual({ openchamber: { other: true } });
    expect(deleted).toBe(false);
  });

  test('removing a parent unlinks before deleting its temporary fork', async () => {
    const order: string[] = [];
    let parentMetadata: Record<string, unknown> = { openchamber: { btwSessionID: 'fork-1' } };

    await cleanupBtwBeforeSessionRemoval('parent-1', {
      getSession: async () => session('parent-1', { btwSessionID: 'fork-1' }),
      patchMetadata: async (_id, transform) => {
        order.push('unlink');
        parentMetadata = transform(parentMetadata);
      },
      deleteTemporarySession: async () => { order.push('delete'); },
    });

    expect(order).toEqual(['unlink', 'delete']);
    expect(parentMetadata).toEqual({});
  });

  test('a stale fork cleanup cannot remove a newer parent link', async () => {
    let parentMetadata: Record<string, unknown> = { openchamber: { btwSessionID: 'fork-2' } };

    await cleanupBtwBeforeSessionRemoval('fork-1', {
      getSession: async () => session('fork-1', { kind: 'btw', originalSessionID: 'parent-1' }),
      patchMetadata: async (_id, transform) => { parentMetadata = transform(parentMetadata); },
      deleteTemporarySession: async () => undefined,
    });

    expect(parentMetadata).toEqual({ openchamber: { btwSessionID: 'fork-2' } });
  });
});
