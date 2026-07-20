import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import { buildTransientSessionExpansionKeys } from './sessionExpansion';

const session = (id: string, parentID?: string): Session => ({
  id,
  time: { created: 1, updated: 1 },
  ...(parentID ? { parentID } : {}),
} as Session);

describe('buildTransientSessionExpansionKeys', () => {
  test('auto-expands only the current subagent ancestor chain without creating stored history', () => {
    const sessions = [
      session('root'),
      session('child', 'root'),
      session('grandchild', 'child'),
      session('unrelated-parent'),
      session('unrelated-child', 'unrelated-parent'),
    ];

    expect(buildTransientSessionExpansionKeys(sessions, 'grandchild')).toEqual(new Set([
      'project:active:child',
      'project:archived:child',
      'recent:active:child',
      'recent:archived:child',
      'global-pinned:active:child',
      'global-pinned:archived:child',
      'project:active:root',
      'project:archived:root',
      'recent:active:root',
      'recent:archived:root',
      'global-pinned:active:root',
      'global-pinned:archived:root',
    ]));
  });
});
