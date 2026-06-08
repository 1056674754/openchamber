import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionFolder, SessionFoldersMap } from '@/stores/useSessionFoldersStore';
import type { ActivitySection } from './SidebarActivitySections';
import type { GroupSearchData, SessionGroup, SessionNode } from './types';
import { compareSessionsByPinnedAndTime, normalizePath } from './utils';

const MAX_VISIBLE_RECENT_SESSIONS = 7;

type ProjectSection = {
  project: {
    id: string;
    pinned?: boolean;
  };
  groups: SessionGroup[];
};

type BuildSidebarSessionPrefetchOrderInput = {
  activitySections: ActivitySection[];
  sectionsForRender: ProjectSection[];
  activeProjectId: string | null;
  showOnlyMainWorkspace: boolean;
  hasSessionSearchQuery: boolean;
  normalizedSessionSearchQuery: string;
  groupSearchDataByGroup: WeakMap<SessionGroup, GroupSearchData>;
  collapsedProjects: Set<string>;
  collapsedGroups: Set<string>;
  expandedSessionGroups: Set<string>;
  expandedParents: Set<string>;
  collapsedFolderIds: Set<string>;
  foldersMap: SessionFoldersMap;
  pinnedSessionIds: Set<string>;
  pinnedSessionIdsByProject: Map<string, Set<string>>;
  sessionOrderIndex: Map<string, number>;
  getOrderedGroups: (projectId: string, groups: SessionGroup[]) => SessionGroup[];
  hideDirectoryControls: boolean;
  sessionGroupMinVisible: number;
  sessionGroupRecentHours: number;
  now?: number;
};

const pushSessionId = (sessionId: string, output: string[], seen: Set<string>): void => {
  if (seen.has(sessionId)) return;
  seen.add(sessionId);
  output.push(sessionId);
};

const getSessionUpdatedAt = (session: Session): number => {
  const updatedAt = session.time?.updated;
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0) {
    return updatedAt;
  }
  const createdAt = session.time?.created;
  return typeof createdAt === 'number' && Number.isFinite(createdAt) && createdAt > 0
    ? createdAt
    : 0;
};

const compareSessionNodes = (
  a: SessionNode,
  b: SessionNode,
  input: BuildSidebarSessionPrefetchOrderInput,
  projectPinnedSessionIds: Set<string>,
): number => {
  const aPinned = input.pinnedSessionIds.has(a.session.id) || projectPinnedSessionIds.has(a.session.id);
  const bPinned = input.pinnedSessionIds.has(b.session.id) || projectPinnedSessionIds.has(b.session.id);

  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned && bPinned) {
    return 0;
  }

  const aIndex = input.sessionOrderIndex.get(a.session.id);
  const bIndex = input.sessionOrderIndex.get(b.session.id);
  if (aIndex !== undefined || bIndex !== undefined) {
    if (aIndex === undefined) return 1;
    if (bIndex === undefined) return -1;
    if (aIndex !== bIndex) return aIndex - bIndex;
  }

  return compareSessionsByPinnedAndTime(a.session, b.session, input.pinnedSessionIds);
};

const collectVisibleNodeIds = (
  node: SessionNode,
  input: BuildSidebarSessionPrefetchOrderInput,
  output: string[],
  seen: Set<string>,
  renderContext: 'project' | 'recent' | 'global-pinned',
  archivedBucket: boolean,
): void => {
  pushSessionId(node.session.id, output, seen);

  const expansionKey = `${renderContext}:${archivedBucket ? 'archived' : 'active'}:${node.session.id}`;
  const childrenVisible = input.hasSessionSearchQuery || input.expandedParents.has(expansionKey);
  if (!childrenVisible) return;

  for (const child of node.children) {
    collectVisibleNodeIds(child, input, output, seen, renderContext, archivedBucket);
  }
};

const getSourceGroupNodes = (
  group: SessionGroup,
  input: BuildSidebarSessionPrefetchOrderInput,
  projectPinnedSessionIds: Set<string>,
): SessionNode[] => {
  const searchData = input.hasSessionSearchQuery ? input.groupSearchDataByGroup.get(group) : null;
  return [...(input.hasSessionSearchQuery ? (searchData?.filteredNodes ?? []) : group.sessions)]
    .sort((a, b) => compareSessionNodes(a, b, input, projectPinnedSessionIds));
};

const shouldKeepFolder = (
  folderId: string,
  group: SessionGroup,
  input: BuildSidebarSessionPrefetchOrderInput,
  folderById: Map<string, { folder: SessionFolder; nodes: SessionNode[] }>,
  childFolderIdsByParentId: Map<string, string[]>,
  cache: Map<string, boolean>,
): boolean => {
  const cached = cache.get(folderId);
  if (cached !== undefined) return cached;

  const entry = folderById.get(folderId);
  if (!entry) {
    cache.set(folderId, false);
    return false;
  }

  const childFolderIds = childFolderIdsByParentId.get(folderId) ?? [];
  if (group.isArchivedBucket && entry.nodes.length === 0) {
    const keep = childFolderIds.some((childId) =>
      shouldKeepFolder(childId, group, input, folderById, childFolderIdsByParentId, cache),
    );
    cache.set(folderId, keep);
    return keep;
  }

  if (!input.hasSessionSearchQuery) {
    cache.set(folderId, true);
    return true;
  }

  const folderMatches = input.normalizedSessionSearchQuery.length > 0
    && entry.folder.name.toLowerCase().includes(input.normalizedSessionSearchQuery);
  if (folderMatches || entry.nodes.length > 0) {
    cache.set(folderId, true);
    return true;
  }

  const keep = childFolderIds.some((childId) =>
    shouldKeepFolder(childId, group, input, folderById, childFolderIdsByParentId, cache),
  );
  cache.set(folderId, keep);
  return keep;
};

const collectGroupSessionIds = (
  group: SessionGroup,
  groupKey: string,
  input: BuildSidebarSessionPrefetchOrderInput,
  output: string[],
  seen: Set<string>,
  options?: { ignoreGroupCollapse?: boolean },
): void => {
  if (!input.hasSessionSearchQuery && !options?.ignoreGroupCollapse && input.collapsedGroups.has(groupKey)) {
    return;
  }

  const groupDirectory = normalizePath(group.directory ?? null);
  const projectPinnedSessionIds = groupDirectory
    ? (input.pinnedSessionIdsByProject.get(groupDirectory) ?? new Set<string>())
    : new Set<string>();
  const sourceGroupNodes = getSourceGroupNodes(group, input, projectPinnedSessionIds);
  const nodeBySessionId = new Map<string, SessionNode>();
  const collectNodeLookup = (nodes: SessionNode[]) => {
    for (const node of nodes) {
      nodeBySessionId.set(node.session.id, node);
      if (node.children.length > 0) collectNodeLookup(node.children);
    }
  };
  collectNodeLookup(sourceGroupNodes);

  const folderScopeKey = group.folderScopeKey ?? groupDirectory;
  const scopeFolders = folderScopeKey ? (input.foldersMap[folderScopeKey] ?? []) : [];
  const foldersForGroupBase = scopeFolders.map((folder) => ({
    folder,
    nodes: folder.sessionIds
      .map((sessionId) => nodeBySessionId.get(sessionId))
      .filter((node): node is SessionNode => Boolean(node))
      .sort((a, b) => compareSessionNodes(a, b, input, projectPinnedSessionIds)),
  }));
  const folderById = new Map(foldersForGroupBase.map((entry) => [entry.folder.id, entry]));
  const childFolderIdsByParentId = new Map<string, string[]>();
  for (const { folder } of foldersForGroupBase) {
    if (!folder.parentId) continue;
    const existing = childFolderIdsByParentId.get(folder.parentId) ?? [];
    existing.push(folder.id);
    childFolderIdsByParentId.set(folder.parentId, existing);
  }

  const keepFolderCache = new Map<string, boolean>();
  const foldersForGroup = foldersForGroupBase.filter(({ folder }) =>
    shouldKeepFolder(folder.id, group, input, folderById, childFolderIdsByParentId, keepFolderCache),
  );
  const keptFolderById = new Map(foldersForGroup.map((entry) => [entry.folder.id, entry]));

  const collectFolder = (folderId: string): void => {
    const entry = keptFolderById.get(folderId);
    if (!entry) return;

    const folderCollapsed = !input.hasSessionSearchQuery && input.collapsedFolderIds.has(folderId);
    if (folderCollapsed) return;

    const childFolderIds = foldersForGroup
      .filter(({ folder }) => folder.parentId === folderId)
      .map(({ folder }) => folder.id);
    for (const childFolderId of childFolderIds) {
      collectFolder(childFolderId);
    }

    for (const node of entry.nodes) {
      collectVisibleNodeIds(node, input, output, seen, 'project', group.isArchivedBucket === true);
    }
  };

  const rootFolders = foldersForGroup.filter(({ folder }) => !folder.parentId);
  for (const { folder } of rootFolders) {
    collectFolder(folder.id);
  }

  const sessionIdsInFolders = new Set(foldersForGroup.flatMap((entry) => entry.folder.sessionIds));
  const ungroupedSessions = sourceGroupNodes.filter((node) => !sessionIdsInFolders.has(node.session.id));
  const maxVisible = getMaxVisibleUngroupedSessions(ungroupedSessions, input);
  const visibleSessions = group.isArchivedBucket
    ? ungroupedSessions
    : input.hasSessionSearchQuery
      ? ungroupedSessions
      : input.expandedSessionGroups.has(groupKey)
        ? ungroupedSessions
        : ungroupedSessions.slice(0, maxVisible);

  const allPinned = new Set([...input.pinnedSessionIds, ...projectPinnedSessionIds]);
  const pinnedNodes: SessionNode[] = [];
  const unpinnedNodes: SessionNode[] = [];
  for (const node of visibleSessions) {
    if (allPinned.has(node.session.id)) pinnedNodes.push(node);
    else unpinnedNodes.push(node);
  }

  for (const node of [...pinnedNodes, ...unpinnedNodes]) {
    collectVisibleNodeIds(node, input, output, seen, 'project', group.isArchivedBucket === true);
  }
};

const getMaxVisibleUngroupedSessions = (
  ungroupedSessions: SessionNode[],
  input: BuildSidebarSessionPrefetchOrderInput,
): number => {
  if (input.hideDirectoryControls) return 10;
  const minVisible = typeof input.sessionGroupMinVisible === 'number' && input.sessionGroupMinVisible >= 1
    ? input.sessionGroupMinVisible
    : 7;
  const recentHoursMs = (typeof input.sessionGroupRecentHours === 'number' && input.sessionGroupRecentHours >= 1
    ? input.sessionGroupRecentHours
    : 48) * 60 * 60 * 1000;
  const cutoff = (input.now ?? Date.now()) - recentHoursMs;
  let recentCount = 0;

  for (const node of ungroupedSessions) {
    if (getSessionUpdatedAt(node.session) > cutoff) {
      recentCount += 1;
    }
  }

  return Math.max(minVisible, recentCount);
};

const getOrderedSectionsForRender = (sections: ProjectSection[]): ProjectSection[] => {
  return [...sections].sort((a, b) => {
    if (a.project.pinned && !b.project.pinned) return -1;
    if (!a.project.pinned && b.project.pinned) return 1;
    return 0;
  });
};

const collectProjectSectionSessionIds = (
  section: ProjectSection,
  input: BuildSidebarSessionPrefetchOrderInput,
  output: string[],
  seen: Set<string>,
): void => {
  const projectId = section.project.id;
  const orderedGroups = input.getOrderedGroups(projectId, section.groups);
  const rootGroup = orderedGroups.find((group) => group.isMain) ?? null;
  const nestedGroups = rootGroup
    ? orderedGroups.filter((group) => group.id !== rootGroup.id)
    : orderedGroups;

  if (rootGroup) {
    collectGroupSessionIds(rootGroup, `${projectId}:${rootGroup.id}`, input, output, seen, { ignoreGroupCollapse: true });
  }

  for (const group of nestedGroups) {
    collectGroupSessionIds(group, `${projectId}:${group.id}`, input, output, seen);
  }
};

export const buildSidebarSessionPrefetchOrder = (
  input: BuildSidebarSessionPrefetchOrderInput,
): string[] => {
  const output: string[] = [];
  const seen = new Set<string>();

  if (!input.hasSessionSearchQuery) {
    for (const section of input.activitySections) {
      const visibleItems = section.key === 'active-now'
        ? section.items.slice(0, MAX_VISIBLE_RECENT_SESSIONS)
        : section.items;
      for (const item of visibleItems) {
        collectVisibleNodeIds(
          item.node,
          input,
          output,
          seen,
          section.key === 'global-pinned' ? 'global-pinned' : 'recent',
          false,
        );
      }
    }
  }

  if (input.showOnlyMainWorkspace) {
    const activeSection = input.sectionsForRender.find((section) => section.project.id === input.activeProjectId)
      ?? input.sectionsForRender[0];
    if (!activeSection) return output;

    const primaryGroup =
      activeSection.groups.find((candidate) => candidate.isMain && candidate.sessions.length > 0)
      ?? activeSection.groups.find((candidate) => candidate.sessions.length > 0)
      ?? activeSection.groups.find((candidate) => candidate.isMain)
      ?? activeSection.groups[0];
    if (primaryGroup) {
      collectGroupSessionIds(primaryGroup, `${activeSection.project.id}:${primaryGroup.id}`, input, output, seen, { ignoreGroupCollapse: true });
    }

    const archivedGroup = activeSection.groups.find((candidate) => candidate.isArchivedBucket);
    if (archivedGroup && archivedGroup.id !== primaryGroup?.id) {
      collectGroupSessionIds(archivedGroup, `${activeSection.project.id}:${archivedGroup.id}`, input, output, seen);
    }
    return output;
  }

  for (const section of getOrderedSectionsForRender(input.sectionsForRender)) {
    if (!input.hasSessionSearchQuery && input.collapsedProjects.has(section.project.id)) {
      continue;
    }
    collectProjectSectionSessionIds(section, input, output, seen);
  }

  return output;
};
