import { describe, expect, test } from 'bun:test';

import { migrateSessionDisplayState, useSessionDisplayStore } from './useSessionDisplayStore';

describe('useSessionDisplayStore project sorting', () => {
  test('defaults to manual ordering', () => {
    expect(useSessionDisplayStore.getState().projectSortOrder).toBe('manual');
  });

  test('migrates the previously persisted recent default to manual', () => {
    expect(migrateSessionDisplayState({ projectSortOrder: 'recent' }, 0)).toEqual({
      projectSortOrder: 'manual',
    });
  });

  test('preserves an explicit alphabetical sort preference', () => {
    expect(migrateSessionDisplayState({ projectSortOrder: 'a-z' }, 0)).toEqual({
      projectSortOrder: 'a-z',
    });
  });
});
