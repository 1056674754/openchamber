import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { getArchivedScopeKey, resolveArchivedFolderName } from '../utils';

export type ProjectForArchivedFolders = {
  id: string;
  normalizedPath: string;
};

type FolderEntry = {
  id: string;
  name: string;
  sessionIds: string[];
};

type Args = {
  normalizedProjects: ProjectForArchivedFolders[];
  isSessionsLoading: boolean;
  foldersMap: Record<string, FolderEntry[]>;
  getArchivedSessionsForProject: (project: { id: string }) => Session[];
  createFolder: (scopeKey: string, name: string, parentId?: string | null) => FolderEntry;
  addSessionToFolder: (scopeKey: string, folderId: string, sessionId: string) => void;
  cleanupSessions: (scopeKey: string, existingSessionIds: Set<string>) => void;
};

export const useArchivedAutoFolders = (args: Args): void => {
  const {
    normalizedProjects,
    isSessionsLoading,
    foldersMap,
    getArchivedSessionsForProject,
    createFolder,
    addSessionToFolder,
    cleanupSessions,
  } = args;

  React.useEffect(() => {
    if (isSessionsLoading) {
      return;
    }

    normalizedProjects.forEach((project) => {
      const scopeKey = getArchivedScopeKey(project.normalizedPath);
      const projectArchivedSessions = getArchivedSessionsForProject(project);
      const sessionIds = new Set(projectArchivedSessions.map((session) => session.id));

      const existingFolders = foldersMap[scopeKey] ?? [];
      const folderByName = new Map(existingFolders.map((folder) => [folder.name.toLowerCase(), folder]));

      projectArchivedSessions.forEach((session) => {
        const folderName = resolveArchivedFolderName(session, project.normalizedPath);
        const key = folderName.toLowerCase();
        let folder = folderByName.get(key);
        if (!folder) {
          folder = createFolder(scopeKey, folderName);
          folderByName.set(key, folder);
        }

        if (!folder.sessionIds.includes(session.id)) {
          addSessionToFolder(scopeKey, folder.id, session.id);
        }
      });

      cleanupSessions(scopeKey, sessionIds);
    });
  }, [
    normalizedProjects,
    isSessionsLoading,
    foldersMap,
    getArchivedSessionsForProject,
    createFolder,
    addSessionToFolder,
    cleanupSessions,
  ]);
};
