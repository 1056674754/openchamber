import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import type { ActivitySection } from './SidebarActivitySections';
import type { GroupSearchData, SessionGroup, SessionNode } from './types';
import { buildSidebarSessionPrefetchOrder } from './prefetchOrder';

const session = (id: string, updated = 100): Session => ({
  id,
  time: { created: updated, updated },
} as Session);

const node = (id: string, children: SessionNode[] = [], updated?: number): SessionNode => ({
  session: session(id, updated),
  children,
  worktree: null,
});

const group = (
  id: string,
  sessions: SessionNode[],
  options?: Partial<SessionGroup>,
): SessionGroup => ({
  id,
  label: id,
  branch: null,
  description: null,
  isMain: id === 'root',
  isArchivedBucket: false,
  worktree: null,
  directory: '/repo',
  folderScopeKey: '/repo',
  sessions,
  ...options,
});

const baseInput = (overrides: Partial<Parameters<typeof buildSidebarSessionPrefetchOrder>[0]> = {}) => ({
  activitySections: [],
  sectionsForRender: [],
  activeProjectId: null,
  showOnlyMainWorkspace: false,
  hasSessionSearchQuery: false,
  normalizedSessionSearchQuery: '',
  groupSearchDataByGroup: new WeakMap<SessionGroup, GroupSearchData>(),
  collapsedProjects: new Set<string>(),
  collapsedGroups: new Set<string>(),
  visibleSessionCountByGroup: new Map<string, number>(),
  expandedParents: new Set<string>(),
  collapsedFolderIds: new Set<string>(),
  foldersMap: {},
  pinnedSessionIds: new Set<string>(),
  pinnedSessionIdsByProject: new Map<string, Set<string>>(),
  sessionOrderIndex: new Map<string, number>(),
  getOrderedGroups: (_projectId: string, groups: SessionGroup[]) => groups,
  hideDirectoryControls: false,
  sessionGroupMinVisible: 7,
  sessionGroupRecentHours: 48,
  now: 1_000,
  ...overrides,
});

describe('buildSidebarSessionPrefetchOrder', () => {
  test('follows rendered pinned-project order before project insertion order', () => {
    const sectionsForRender = [
      { project: { id: 'project-a' }, groups: [group('root', [node('a1')])] },
      { project: { id: 'project-b', pinned: true }, groups: [group('root', [node('b1')])] },
    ];

    expect(buildSidebarSessionPrefetchOrder(baseInput({ sectionsForRender }))).toEqual(['b1', 'a1']);
  });

  test('skips collapsed groups and folders while keeping expanded session children', () => {
    const parent = node('parent', [node('child')]);
    const rootGroup = group('root', [parent, node('inside-folder')]);
    const collapsedGroup = group('worktree:/repo-wt', [node('hidden-group')], {
      isMain: false,
      directory: '/repo-wt',
      folderScopeKey: '/repo-wt',
    });
    const sectionsForRender = [
      { project: { id: 'project-a' }, groups: [rootGroup, collapsedGroup] },
    ];

    expect(buildSidebarSessionPrefetchOrder(baseInput({
      sectionsForRender,
      collapsedGroups: new Set(['project-a:worktree:/repo-wt']),
      collapsedFolderIds: new Set(['folder-1']),
      expandedParents: new Set(['project:active:parent']),
      foldersMap: {
        '/repo': [{
          id: 'folder-1',
          name: 'Folder',
          sessionIds: ['inside-folder'],
          createdAt: 1,
          parentId: null,
        }],
      },
    }))).toEqual(['parent', 'child']);
  });

  test('prioritizes top activity sections and limits recent items to visible rows', () => {
    const recentItems = Array.from({ length: 8 }, (_, index) => ({
      node: node(`recent-${index + 1}`),
      projectId: null,
      groupDirectory: null,
      secondaryMeta: null,
    }));
    const activitySections: ActivitySection[] = [
      {
        key: 'global-pinned',
        title: 'Pinned',
        items: [{
          node: node('pinned'),
          projectId: null,
          groupDirectory: null,
          secondaryMeta: null,
        }],
      },
      {
        key: 'active-now',
        title: 'Recent',
        items: recentItems,
      },
    ];
    const sectionsForRender = [
      { project: { id: 'project-a' }, groups: [group('root', [node('pinned'), node('project-session')])] },
    ];

    expect(buildSidebarSessionPrefetchOrder(baseInput({
      activitySections,
      sectionsForRender,
    }))).toEqual([
      'pinned',
      'recent-1',
      'recent-2',
      'recent-3',
      'recent-4',
      'recent-5',
      'recent-6',
      'recent-7',
      'project-session',
    ]);
  });
});
