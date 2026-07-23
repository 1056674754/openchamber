import { beforeEach, describe, expect, test } from 'bun:test';

import { useFilesViewTabsStore } from './useFilesViewTabsStore';

describe('useFilesViewTabsStore', () => {
  beforeEach(() => {
    useFilesViewTabsStore.setState({ byRoot: {} });
  });

  test('removes stale expanded paths without closing files', () => {
    const root = '/repo';
    const store = useFilesViewTabsStore.getState();

    store.addOpenPath(root, '/repo/src/index.ts');
    store.expandPaths(root, [
      '/repo/src',
      '/repo/stale',
      '/repo/stale/nested',
      '/repo/other',
    ]);

    store.removeExpandedPathsByPrefix(root, '/repo/stale');

    const state = useFilesViewTabsStore.getState().byRoot[root];
    expect(state?.openPaths).toEqual(['/repo/src/index.ts']);
    expect(state?.expandedPaths).toEqual(['/repo/src', '/repo/other']);
  });
});
