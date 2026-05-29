import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';

import { buildArchivedSessionsByScope } from './useArchivedAutoFolders';

const session = (id: string): Session => ({ id } as Session);

describe('buildArchivedSessionsByScope', () => {
  test('unions archived sessions for projects sharing the same scope', () => {
    const projects = [
      { id: 'project-a', normalizedPath: '/repo' },
      { id: 'project-b', normalizedPath: '/repo' },
    ];
    const byProject: Record<string, Session[]> = {
      'project-a': [session('ses-a')],
      'project-b': [],
    };

    const byScope = buildArchivedSessionsByScope(projects, (project) => byProject[project.id] ?? []);

    expect(byScope.size).toBe(1);
    expect(byScope.get('__archived__:/repo')?.sessions.map((item) => item.id)).toEqual(['ses-a']);
  });

  test('dedupes sessions within a shared scope', () => {
    const projects = [
      { id: 'project-a', normalizedPath: '/repo' },
      { id: 'project-b', normalizedPath: '/repo' },
    ];
    const shared = session('ses-shared');
    const byProject: Record<string, Session[]> = {
      'project-a': [shared],
      'project-b': [shared, session('ses-b')],
    };

    const byScope = buildArchivedSessionsByScope(projects, (project) => byProject[project.id] ?? []);

    expect(byScope.get('__archived__:/repo')?.sessions.map((item) => item.id)).toEqual(['ses-shared', 'ses-b']);
  });
});
