import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
import { getArchivedScopeKey, normalizePath } from '../utils';

type NormalizedProject = {
  id: string;
  normalizedPath: string;
};

type Args = {
  isSessionsLoading: boolean;
  sessions: Session[];
  normalizedProjects: NormalizedProject[];
  getArchivedSessionsForProject: (project: { id: string }) => Session[];
  cleanupSessions: (scopeKey: string, validSessionIds: Set<string>) => void;
};

export const useSessionFolderCleanup = (args: Args): void => {
  const {
    isSessionsLoading,
    sessions,
    normalizedProjects,
    getArchivedSessionsForProject,
    cleanupSessions,
  } = args;

  React.useEffect(() => {
    if (isSessionsLoading) {
      return;
    }

    // Data-loss guard: if projects haven't loaded yet but folder scopes exist
    // in storage, we'd call cleanupSessions(scopeKey, new Set()) for every
    // archived scope and wipe valid folder contents. Wait until projects
    // are populated before reconciling.
    if (normalizedProjects.length === 0) {
      return;
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
      idsByScope.set(scopeKey, new Set(archivedForProject.map((session) => session.id)));
    });

    const currentFoldersMap = useSessionFoldersStore.getState().foldersMap;
    const allScopeKeys = new Set([...Object.keys(currentFoldersMap), ...idsByScope.keys()]);
    allScopeKeys.forEach((scopeKey) => {
      cleanupSessions(scopeKey, idsByScope.get(scopeKey) ?? new Set<string>());
    });
  }, [
    cleanupSessions,
    getArchivedSessionsForProject,
    isSessionsLoading,
    normalizedProjects,
    sessions,
  ]);
};
