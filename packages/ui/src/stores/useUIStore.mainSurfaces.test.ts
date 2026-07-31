import { beforeEach, describe, expect, test } from 'bun:test';

import { useUIStore } from './useUIStore';

describe('useUIStore main surfaces', () => {
  beforeEach(() => {
    useUIStore.setState({
      isArchivePageOpen: false,
      isScheduledTasksDialogOpen: false,
      isMultiRunLauncherOpen: false,
      worktreesPageProjectId: null,
    });
  });

  test('keeps only the most recently opened surface active', () => {
    useUIStore.getState().setArchivePageOpen(true);
    useUIStore.getState().setWorktreesPageProjectId('project-1');
    useUIStore.getState().setScheduledTasksDialogOpen(true);

    const state = useUIStore.getState();
    expect(state.isScheduledTasksDialogOpen).toBe(true);
    expect(state.isArchivePageOpen).toBe(false);
    expect(state.worktreesPageProjectId).toBe(null);
    expect(state.isMultiRunLauncherOpen).toBe(false);
  });

  test('closes every surface with one navigation action', () => {
    useUIStore.getState().setArchivePageOpen(true);
    useUIStore.getState().closeMainSurfaces();

    const state = useUIStore.getState();
    expect(state.isArchivePageOpen).toBe(false);
    expect(state.isScheduledTasksDialogOpen).toBe(false);
    expect(state.worktreesPageProjectId).toBe(null);
    expect(state.isMultiRunLauncherOpen).toBe(false);
  });
});
