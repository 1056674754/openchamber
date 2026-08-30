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

  test('defaults to worktree grouping with sticky zone headers', () => {
    expect(useSessionDisplayStore.getState().sessionGroupingMode).toBe('by-worktree');
    expect(useSessionDisplayStore.getState().stickyZoneHeaders).toBe(true);
  });

  test('preserves fork display mode while migrating new sidebar preferences', () => {
    expect(migrateSessionDisplayState({
      displayMode: 'minimal',
      sessionGroupingMode: 'flat',
      stickyZoneHeaders: false,
      projectSortOrder: 'a-z',
    }, 1)).toEqual({
      displayMode: 'minimal',
      sessionGroupingMode: 'flat',
      stickyZoneHeaders: false,
      projectSortOrder: 'a-z',
    });
  });
});

describe('useSessionDisplayStore project display', () => {
  test('stores focused-project mode independently from row density and grouping', () => {
    useSessionDisplayStore.setState({
      displayMode: 'minimal',
      sessionGroupingMode: 'flat',
      projectDisplayMode: 'single',
      singleProjectId: 'project-a',
    });

    expect(useSessionDisplayStore.getState().projectDisplayMode).toBe('single');
    expect(useSessionDisplayStore.getState().singleProjectId).toBe('project-a');
    expect(useSessionDisplayStore.getState().displayMode).toBe('minimal');
    expect(useSessionDisplayStore.getState().sessionGroupingMode).toBe('flat');

    useSessionDisplayStore.setState({ projectDisplayMode: 'all', singleProjectId: null });
  });
});
