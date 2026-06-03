import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionGroup, SessionNode, GroupSearchData } from '../types';
import { dedupeSessionsById, normalizePath } from '../utils';
import type { WorktreeMetadata } from '@/types/worktree';
import type { SessionFoldersMap } from '@/stores/useSessionFoldersStore';
import { dedupeWorktreesByPath, getProjectWorktreeKey, getWorktreesForProject } from '@/lib/worktrees/worktreeKeys';

type ProjectItem = {
  id: string;
  path: string;
  label?: string;
  normalizedPath: string;
  icon?: string;
  color?: string;
  iconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' };
  iconBackground?: string;
  serverId?: string;
  unavailable?: boolean;
};

type ProjectSection = {
  project: ProjectItem;
  groups: SessionGroup[];
};

type Args = {
  normalizedProjects: ProjectItem[];
  getSessionsForProject: (project: { id: string }) => Session[];
  getArchivedSessionsForProject: (project: { id: string }) => Session[];
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
  projectRepoStatus: Map<string, boolean | null>;
  projectRootBranches: Map<string, string | null>;
  buildGroupedSessions: (
    sessions: Session[],
    projectRoot: string,
    availableWorktrees: WorktreeMetadata[],
    rootBranch: string | null,
    isRepo: boolean,
  ) => SessionGroup[];
  hasSessionSearchQuery: boolean;
  normalizedSessionSearchQuery: string;
  filterSessionNodesForSearch: (nodes: SessionNode[], query: string) => SessionNode[];
  buildGroupSearchText: (group: SessionGroup) => string;
  foldersMap: SessionFoldersMap;
};

export const useSessionSidebarSections = (args: Args) => {
  const {
    normalizedProjects,
    getSessionsForProject,
    getArchivedSessionsForProject,
    availableWorktreesByProject,
    projectRepoStatus,
    projectRootBranches,
    buildGroupedSessions,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
    filterSessionNodesForSearch,
    buildGroupSearchText,
    foldersMap,
  } = args;

  const projectSections = React.useMemo<ProjectSection[]>(() => {
    const projectKeysBackedByWorktrees = new Set<string>();
    for (const project of normalizedProjects) {
      const worktrees = dedupeWorktreesByPath(
        getWorktreesForProject(
          availableWorktreesByProject,
          project.normalizedPath,
          project.serverId,
        ),
        project.serverId,
      );
      for (const worktree of worktrees) {
        const worktreePath = normalizePath(worktree.path);
        if (!worktreePath || worktreePath === project.normalizedPath) continue;
        projectKeysBackedByWorktrees.add(getProjectWorktreeKey(
          worktreePath,
          worktree.serverId ?? project.serverId,
        ));
      }
    }

    return normalizedProjects
      .filter((project) => !projectKeysBackedByWorktrees.has(getProjectWorktreeKey(
        project.normalizedPath,
        project.serverId,
      )))
      .map((project) => {
      const projectSessions = dedupeSessionsById([
        ...getSessionsForProject(project),
        ...getArchivedSessionsForProject(project),
      ]);
      const worktreesForProject = dedupeWorktreesByPath(
        getWorktreesForProject(
          availableWorktreesByProject,
          project.normalizedPath,
          project.serverId,
        ),
        project.serverId,
      );
      const isRepo = projectRepoStatus.get(project.id) === true;
      const groups = buildGroupedSessions(
        projectSessions,
        project.normalizedPath,
        worktreesForProject,
        projectRootBranches.get(project.id) ?? null,
        isRepo,
      );
      return { project, groups };
    });
  }, [
    normalizedProjects,
    getSessionsForProject,
    getArchivedSessionsForProject,
    availableWorktreesByProject,
    projectRepoStatus,
    buildGroupedSessions,
    projectRootBranches,
  ]);

  const visibleProjectSections = React.useMemo(() => {
    return projectSections;
  }, [projectSections]);

  const groupSearchDataByGroup = React.useMemo(() => {
    const result = new WeakMap<SessionGroup, GroupSearchData>();
    if (!hasSessionSearchQuery) {
      return result;
    }

    const countNodes = (nodes: SessionNode[]): number => nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);

    visibleProjectSections.forEach((section) => {
      section.groups.forEach((group) => {
        const filteredNodes = filterSessionNodesForSearch(group.sessions, normalizedSessionSearchQuery);
        const matchedSessionCount = countNodes(filteredNodes);
        const groupMatches = buildGroupSearchText(group).includes(normalizedSessionSearchQuery);
        const scopeKey = normalizePath(group.directory ?? null);
        const scopeFolders = scopeKey ? (foldersMap[scopeKey] ?? []) : [];
        const folderNameMatchCount = scopeFolders.filter((folder) => folder.name.toLowerCase().includes(normalizedSessionSearchQuery)).length;

        result.set(group, {
          filteredNodes,
          matchedSessionCount,
          folderNameMatchCount,
          groupMatches,
          hasMatch: groupMatches || matchedSessionCount > 0 || folderNameMatchCount > 0,
        });
      });
    });

    return result;
  }, [
    hasSessionSearchQuery,
    visibleProjectSections,
    filterSessionNodesForSearch,
    normalizedSessionSearchQuery,
    buildGroupSearchText,
    foldersMap,
  ]);

  const searchableProjectSections = React.useMemo(() => {
    if (!hasSessionSearchQuery) {
      return visibleProjectSections;
    }

    return visibleProjectSections
      .map((section) => ({
        ...section,
        groups: section.groups.filter((group) => groupSearchDataByGroup.get(group)?.hasMatch === true),
      }))
      .filter((section) => section.groups.length > 0);
  }, [hasSessionSearchQuery, visibleProjectSections, groupSearchDataByGroup]);

  const sectionsForRender = hasSessionSearchQuery ? searchableProjectSections : visibleProjectSections;

  const searchMatchCount = React.useMemo(() => {
    if (!hasSessionSearchQuery) {
      return 0;
    }

    return sectionsForRender.reduce((total, section) => {
      return total + section.groups.reduce((groupTotal, group) => {
        const data = groupSearchDataByGroup.get(group);
        if (!data) {
          return groupTotal;
        }
        const metadataMatches = data.folderNameMatchCount + (data.groupMatches ? 1 : 0);
        return groupTotal + data.matchedSessionCount + metadataMatches;
      }, 0);
    }, 0);
  }, [hasSessionSearchQuery, sectionsForRender, groupSearchDataByGroup]);

  return {
    projectSections,
    visibleProjectSections,
    groupSearchDataByGroup,
    searchableProjectSections,
    sectionsForRender,
    searchMatchCount,
  };
};
