import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { ProjectEntry } from '@/lib/api/types';

mock.module('@/lib/opencode/client', () => ({
  opencodeClient: {
    setDirectory: () => {},
  },
}));

mock.module('@/lib/persistence', () => ({
  updateDesktopSettings: async () => {},
}));

const { useProjectsStore } = await import('./useProjectsStore');

const resetProjects = (projects: ProjectEntry[] = []) => {
  useProjectsStore.setState({
    projects,
    activeProjectId: null,
    hasLoadedSharedSettings: true,
    discoverProjectIcon: async () => ({ ok: true }),
  });
};

describe('useProjectsStore.addProjects', () => {
  beforeEach(() => resetProjects());

  test('adds a normalized batch and activates its first project', () => {
    const added = useProjectsStore.getState().addProjects(['/one/', '/two', '/three']);

    expect(added.map((project) => project.path)).toEqual(['/one', '/two', '/three']);
    expect(added[0].addedAt).toBe(added[1].addedAt);
    expect(useProjectsStore.getState().projects.map((project) => project.path)).toEqual(['/one', '/two', '/three']);
    expect(useProjectsStore.getState().activeProjectId).toBe(added[0].id);
  });

  test('skips existing local projects and duplicates within the batch', () => {
    useProjectsStore.getState().addProjects(['/one']);

    const added = useProjectsStore.getState().addProjects(['/one', '/two', '/two', '/one']);

    expect(added.map((project) => project.path)).toEqual(['/two']);
    expect(useProjectsStore.getState().projects.map((project) => project.path)).toEqual(['/one', '/two']);
  });

  test('does not let a remote project suppress the same local path', () => {
    resetProjects([{
      id: 'dev3-one',
      path: '/one',
      label: 'Remote one',
      serverId: 'dev3',
      addedAt: 1,
      lastOpenedAt: 1,
    }]);

    const added = useProjectsStore.getState().addProjects(['/one']);

    expect(added).toHaveLength(1);
    expect(added[0].serverId).toBeUndefined();
    expect(useProjectsStore.getState().projects).toHaveLength(2);
  });

  test('ignores invalid paths without clearing existing projects', () => {
    useProjectsStore.getState().addProjects(['/one']);

    const added = useProjectsStore.getState().addProjects(['', '   ', 42 as unknown as string]);

    expect(added).toEqual([]);
    expect(useProjectsStore.getState().projects.map((project) => project.path)).toEqual(['/one']);
  });
});
