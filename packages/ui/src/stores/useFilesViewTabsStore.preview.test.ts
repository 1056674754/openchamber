import { beforeEach, describe, expect, test } from 'bun:test';

import { useFilesViewTabsStore } from './useFilesViewTabsStore';

const ROOT = '/repo';

const rootState = () => useFilesViewTabsStore.getState().byRoot[ROOT];

beforeEach(() => {
  useFilesViewTabsStore.setState({ byRoot: {} });
});

describe('useFilesViewTabsStore preview tabs', () => {
  test('a preview replaces the previous preview instead of adding a tab', () => {
    const store = useFilesViewTabsStore.getState();
    store.addOpenPath(ROOT, `${ROOT}/kept.ts`);
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });
    store.addOpenPath(ROOT, `${ROOT}/b.ts`, { preview: true });

    expect(rootState()?.openPaths).toEqual([`${ROOT}/kept.ts`, `${ROOT}/b.ts`]);
    expect(rootState()?.previewPath).toBe(`${ROOT}/b.ts`);
  });

  test('a regular open or an explicit pin keeps the tab', () => {
    const store = useFilesViewTabsStore.getState();
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });
    // A regular open pins the preview in place.
    store.addOpenPath(ROOT, `${ROOT}/a.ts`);
    expect(rootState()?.openPaths).toEqual([`${ROOT}/a.ts`]);
    expect(rootState()?.previewPath).toBeNull();

    // The next preview replaces nothing (no preview open) and pins survive it.
    store.addOpenPath(ROOT, `${ROOT}/b.ts`, { preview: true });
    store.pinOpenPath(ROOT, `${ROOT}/b.ts`);
    store.addOpenPath(ROOT, `${ROOT}/c.ts`, { preview: true });
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });

    expect(rootState()?.openPaths).toEqual([
      `${ROOT}/a.ts`,
      `${ROOT}/b.ts`,
      `${ROOT}/c.ts`,
    ]);
    expect(rootState()?.previewPath).toBe(`${ROOT}/c.ts`);
  });

  test('previewing the current preview keeps it as the preview', () => {
    const store = useFilesViewTabsStore.getState();
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });

    expect(rootState()?.openPaths).toEqual([`${ROOT}/a.ts`]);
    expect(rootState()?.previewPath).toBe(`${ROOT}/a.ts`);
  });

  test('closing the preview or its folder clears the preview pointer', () => {
    const store = useFilesViewTabsStore.getState();
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });
    store.removeOpenPath(ROOT, `${ROOT}/a.ts`);
    expect(rootState()?.previewPath).toBeNull();

    store.addOpenPath(ROOT, `${ROOT}/nested/b.ts`, { preview: true });
    store.removeOpenPathsByPrefix(ROOT, `${ROOT}/nested`);
    expect(rootState()?.previewPath).toBeNull();
    expect(rootState()?.openPaths).toEqual([]);
  });

  test('setSelectedPath does not disturb preview state', () => {
    const store = useFilesViewTabsStore.getState();
    store.addOpenPath(ROOT, `${ROOT}/a.ts`, { preview: true });
    store.setSelectedPath(ROOT, `${ROOT}/kept.ts`);

    expect(rootState()?.previewPath).toBe(`${ROOT}/a.ts`);
    expect(rootState()?.selectedPath).toBe(`${ROOT}/kept.ts`);
  });
});
