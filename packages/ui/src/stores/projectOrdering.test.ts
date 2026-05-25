import { describe, expect, test } from 'bun:test';

import { reorderProjectList, reorderProjectListById } from './projectOrdering';

describe('project ordering', () => {
  test('reorders by index', () => {
    const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

    expect(reorderProjectList(projects, 0, 2)?.map((project) => project.id)).toEqual(['b', 'c', 'a']);
  });

  test('returns null for invalid or noop index moves', () => {
    const projects = [{ id: 'a' }, { id: 'b' }];

    expect(reorderProjectList(projects, -1, 1)).toBeNull();
    expect(reorderProjectList(projects, 0, 0)).toBeNull();
    expect(reorderProjectList(projects, 0, 2)).toBeNull();
  });

  test('reorders visible project ids against a full list containing hidden worktree-backed projects', () => {
    const projects = [
      { id: 'project-a' },
      { id: 'hidden-worktree' },
      { id: 'project-b' },
      { id: 'project-c' },
    ];

    const reordered = reorderProjectListById(projects, 'project-b', 'project-c');

    expect(reordered?.map((project) => project.id)).toEqual([
      'project-a',
      'hidden-worktree',
      'project-c',
      'project-b',
    ]);
  });

  test('returns null for missing project ids', () => {
    const projects = [{ id: 'a' }, { id: 'b' }];

    expect(reorderProjectListById(projects, 'missing', 'b')).toBeNull();
    expect(reorderProjectListById(projects, 'a', 'missing')).toBeNull();
  });
});
