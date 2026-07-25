import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
import { getArchivedScopeKey, normalizePath } from '../utils';

type NormalizedProject = {
  id: string;
  normalizedPath: string;
  serverId?: string;
};

type Args = {
  isSessionsLoading: boolean;
  hasCompleteSessionSnapshot: boolean;
  isScopeSnapshotComplete?: (serverId: string, directory: string) => boolean;
  sessions: Session[];
  normalizedProjects: NormalizedProject[];
  getArchivedSessionsForProject: (project: { id: string }) => Session[];
  cleanupSessions: (scopeKey: string, validSessionIds: Set<string>) => void;
};

export const useSessionFolderCleanup = (args: Args): void => {
  const {
    isSessionsLoading,
    hasCompleteSessionSnapshot,
    isScopeSnapshotComplete,
    sessions,
    normalizedProjects,
    getArchivedSessionsForProject,
    cleanupSessions,
  } = args;

  React.useEffect(() => {
    if (isSessionsLoading || !hasCompleteSessionSnapshot) {
      return;
    }

    // Data-loss guard: if projects haven't loaded yet but folder scopes exist
    // in storage, we'd call cleanupSessions(scopeKey, new Set()) for every
    // archived scope and wipe valid folder contents. Wait until projects
    // are populated before reconciling.
    if (normalizedProjects.length === 0) {
      return;
    }

    if (
      sessions.length === 0
      && normalizedProjects.every((project) => getArchivedSessionsForProject(project).length === 0)
    ) {
      return;
    }

    const completeDirectories = new Set<string>();
    const incompleteDirectories = new Set<string>();
    for (const project of normalizedProjects) {
      const serverId = project.serverId && project.serverId !== DEFAULT_SERVER_ID
        ? project.serverId
        : DEFAULT_SERVER_ID;
      const scopeComplete = isScopeSnapshotComplete?.(serverId, project.normalizedPath) ?? false;
      // Default-server roots bootstrap sets isCompleteSnapshot without per-directory
      // scope keys. Remote catalogs must wait for their scoped authoritative snapshot.
      const complete = scopeComplete
        || (serverId === DEFAULT_SERVER_ID && hasCompleteSessionSnapshot);
      if (complete) {
        completeDirectories.add(project.normalizedPath);
        completeDirectories.add(getArchivedScopeKey(project.normalizedPath));
      } else {
        incompleteDirectories.add(project.normalizedPath);
        incompleteDirectories.add(getArchivedScopeKey(project.normalizedPath));
      }
    }

    const idsByScope = new Map<string, Set<string>>();
    sessions.forEach((session) => {
      const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
      if (!directory) {
        return;
      }
      const existing = idsByScope.get(directory);
      if (existing) {
        existing.add(session.id);
        return;
      }
      idsByScope.set(directory, new Set([session.id]));
    });

    normalizedProjects.forEach((project) => {
      const scopeKey = getArchivedScopeKey(project.normalizedPath);
      const archivedForProject = getArchivedSessionsForProject(project);
      const existing = idsByScope.get(scopeKey);
      if (existing) {
        archivedForProject.forEach((session) => existing.add(session.id));
        return;
      }
      idsByScope.set(scopeKey, new Set(archivedForProject.map((session) => session.id)));
    });

    const currentFoldersMap = useSessionFoldersStore.getState().foldersMap;
    const allScopeKeys = new Set([...Object.keys(currentFoldersMap), ...idsByScope.keys()]);
    allScopeKeys.forEach((scopeKey) => {
      // Skip scopes whose owning server/directory catalog is not yet complete.
      if (incompleteDirectories.has(scopeKey)) {
        return;
      }
      if (
        isScopeSnapshotComplete
        && !completeDirectories.has(scopeKey)
        && !idsByScope.has(scopeKey)
      ) {
        // Unknown folder scopes with no matching complete project: leave alone.
        return;
      }
      cleanupSessions(scopeKey, idsByScope.get(scopeKey) ?? new Set<string>());
    });
  }, [
    cleanupSessions,
    getArchivedSessionsForProject,
    hasCompleteSessionSnapshot,
    isScopeSnapshotComplete,
    isSessionsLoading,
    normalizedProjects,
    sessions,
  ]);
};
