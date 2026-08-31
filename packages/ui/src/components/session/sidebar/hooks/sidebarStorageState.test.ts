import { describe, expect, test } from 'bun:test';
import { readSidebarStorageState } from './sidebarStorageState';

const keys = {
  sessionExpanded: 'expanded',
  projectCollapse: 'projects',
  groupOrder: 'order',
  projectActiveSession: 'active',
  groupCollapse: 'groups',
  tempSessionsCollapse: 'temp',
} as const;

const createStorage = (entries: Record<string, string>) => ({
  getItem: (key: string): string | null => entries[key] ?? null,
});

describe('readSidebarStorageState', () => {
  test('reads every host-backed sidebar state slice', () => {
    const storage = createStorage({
      expanded: JSON.stringify(['parent-a', 7, 'parent-b']),
      projects: JSON.stringify(['project-a']),
      order: JSON.stringify({ 'project-a': ['group-b', 5, 'group-a'] }),
      active: JSON.stringify({ 'project-a': 'session-a', ignored: '' }),
      groups: JSON.stringify(['group-a']),
      temp: 'true',
    });

    const state = readSidebarStorageState(storage, keys);

    expect(state.expandedParents).toEqual(new Set(['parent-a', 'parent-b']));
    expect(state.collapsedProjects).toEqual(new Set(['project-a']));
    expect(state.groupOrderByProject).toEqual(new Map([['project-a', ['group-b', 'group-a']]]));
    expect(state.activeSessionByProject).toEqual(new Map([['project-a', 'session-a']]));
    expect(state.collapsedGroups).toEqual(new Set(['group-a']));
    expect(state.tempSessionsCollapsed).toBe(true);
  });

  test('returns null slices for absent or malformed values', () => {
    const storage = createStorage({
      expanded: '{',
      order: JSON.stringify(['not-a-map']),
      active: JSON.stringify(null),
      temp: 'invalid',
    });

    expect(readSidebarStorageState(storage, keys)).toEqual({
      expandedParents: null,
      collapsedProjects: null,
      groupOrderByProject: null,
      activeSessionByProject: null,
      collapsedGroups: null,
      tempSessionsCollapsed: null,
    });
  });
});
