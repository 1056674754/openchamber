import { beforeEach, describe, expect, test } from 'bun:test';

import { useBtwStore } from './useBtwStore';

beforeEach(() => useBtwStore.setState({ byParent: {} }));

describe('btw UI state', () => {
  test('merges transient state independently per parent', () => {
    useBtwStore.getState().setPanelState('parent-1', { creating: true });
    useBtwStore.getState().setPanelState('parent-1', { collapsed: true });
    useBtwStore.getState().setPanelState('parent-2', { destroying: true });
    expect(useBtwStore.getState().byParent).toEqual({
      'parent-1': { creating: true, collapsed: true },
      'parent-2': { destroying: true },
    });
  });

  test('clear removes only the requested parent and unknown is a no-op', () => {
    useBtwStore.getState().setPanelState('parent-1', { collapsed: true });
    useBtwStore.getState().setPanelState('parent-2', { collapsed: true });
    useBtwStore.getState().clearPanelState('parent-1');
    expect(useBtwStore.getState().byParent).toEqual({ 'parent-2': { collapsed: true } });
    const before = useBtwStore.getState().byParent;
    useBtwStore.getState().clearPanelState('missing');
    expect(useBtwStore.getState().byParent).toBe(before);
  });
});
