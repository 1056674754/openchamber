import { afterEach, describe, expect, test } from 'bun:test';

import { isPathWithinRoot, useFilesViewTabsStore } from '../useFilesViewTabsStore';

describe('isPathWithinRoot', () => {
  test('accepts an absolute path whose canonical form differs from the configured root', () => {
    // Regression: a remote project root configured as /srv/app (symlink) while the remote fs
    // listing returns canonical paths under /home/user/project. The strict prefix check silently
    // dropped the open/select write while the guardless context-panel tab still registered,
    // leaving the editor stuck on "Pick a file from the tree".
    expect(isPathWithinRoot('/home/user/project/src/foo.ts', '/srv/app')).toBe(true);
  });

  test('accepts a path genuinely within the root', () => {
    expect(isPathWithinRoot('/home/user/project/src/foo.ts', '/home/user/project')).toBe(true);
  });

  test('treats the root itself as within-root', () => {
    expect(isPathWithinRoot('/home/user/project', '/home/user/project')).toBe(true);
  });

  test('keeps strict prefix checking for relative paths', () => {
    expect(isPathWithinRoot('src/foo.ts', '/home/user/project')).toBe(false);
    expect(isPathWithinRoot('src/foo.ts', 'src')).toBe(true);
  });

  test('rejects empty root or path', () => {
    expect(isPathWithinRoot('/home/user/project', '')).toBe(false);
    expect(isPathWithinRoot('', '/home/user/project')).toBe(false);
    expect(isPathWithinRoot('', '')).toBe(false);
  });
});

describe('useFilesViewTabsStore remote symlink regression', () => {
  afterEach(() => {
    useFilesViewTabsStore.setState({ byRoot: {} });
  });

  test('addOpenPath writes the entry when the file path is absolute but not string-prefix-equal to root', () => {
    const symlinkRoot = '/srv/app';
    const canonicalPath = '/home/user/project/src/foo.ts';

    useFilesViewTabsStore.getState().addOpenPath(symlinkRoot, canonicalPath);

    const entry = useFilesViewTabsStore.getState().byRoot[symlinkRoot];
    expect(entry).toBeDefined();
    expect(entry?.openPaths).toContain(canonicalPath);
    expect(entry?.selectedPath).toBe(canonicalPath);
  });

  test('setSelectedPath tolerates the symlink/canonical divergence', () => {
    const symlinkRoot = '/srv/app';
    const canonicalPath = '/home/user/project/src/bar.ts';

    useFilesViewTabsStore.getState().setSelectedPath(symlinkRoot, canonicalPath);

    expect(useFilesViewTabsStore.getState().byRoot[symlinkRoot]?.selectedPath).toBe(canonicalPath);
  });
});
