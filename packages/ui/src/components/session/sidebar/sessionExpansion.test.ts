import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  buildTransientSessionExpansionKeys,
  getNextSessionExpansionKeys,
  shouldRenderSessionExpanded,
} from './sessionExpansion';

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

describe('demand-loaded session expansion', () => {
  test('renders a persisted expansion as collapsed until children are available', () => {
    expect(shouldRenderSessionExpanded({
      hasSessionSearchQuery: false,
      expansionRequested: true,
      hasChildren: false,
      childrenLoaded: false,
    })).toBe(false);

    expect(shouldRenderSessionExpanded({
      hasSessionSearchQuery: false,
      expansionRequested: true,
      hasChildren: false,
      childrenLoaded: true,
    })).toBe(true);
  });

  test('the first click keeps a hidden persisted expansion requested', () => {
    const expansionKey = 'project:active:root';
    const previous = new Set([expansionKey]);

    expect(getNextSessionExpansionKeys(previous, expansionKey, false)).toEqual(
      new Set([expansionKey]),
    );
    expect(previous).toEqual(new Set([expansionKey]));
  });
});
