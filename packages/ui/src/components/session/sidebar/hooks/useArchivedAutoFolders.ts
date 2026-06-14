import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
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
  defaultCollapseArchivedFolders: (scopeKey: string, folderIds: string[]) => void;
};

type ArchivedScopeSessions = {
  projectRoot: string;
  sessions: Session[];
};

export const buildArchivedSessionsByScope = (
  normalizedProjects: ProjectForArchivedFolders[],
  getArchivedSessionsForProject: (project: { id: string }) => Session[],
): Map<string, ArchivedScopeSessions> => {
  const sessionsByScope = new Map<string, ArchivedScopeSessions>();

  normalizedProjects.forEach((project) => {
    const scopeKey = getArchivedScopeKey(project.normalizedPath);
    const existing = sessionsByScope.get(scopeKey);
    const entry = existing ?? { projectRoot: project.normalizedPath, sessions: [] };
    const seen = new Set(entry.sessions.map((session) => session.id));

    getArchivedSessionsForProject(project).forEach((session) => {
      if (seen.has(session.id)) {
        return;
      }
      seen.add(session.id);
      entry.sessions.push(session);
    });

    if (!existing) {
      sessionsByScope.set(scopeKey, entry);
    }
  });

  return sessionsByScope;
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
    defaultCollapseArchivedFolders,
  } = args;

  React.useEffect(() => {
    if (isSessionsLoading) {
      return;
    }

    const sessionsByScope = buildArchivedSessionsByScope(normalizedProjects, getArchivedSessionsForProject);

    sessionsByScope.forEach(({ projectRoot, sessions }, scopeKey) => {
      const sessionIds = new Set(sessions.map((session) => session.id));

      const existingFolders = foldersMap[scopeKey] ?? [];
      const folderByName = new Map(existingFolders.map((folder) => [folder.name.toLowerCase(), folder]));

      sessions.forEach((session) => {
        const folderName = resolveArchivedFolderName(session, projectRoot);
        const key = folderName.toLowerCase();
        let folder = folderByName.get(key);
        if (!folder) {
          const latestFolders = useSessionFoldersStore.getState().foldersMap[scopeKey] ?? [];
          folder = latestFolders.find((candidate) => candidate.name.toLowerCase() === key);
        }
        if (!folder) {
          folder = createFolder(scopeKey, folderName);
          folderByName.set(key, folder);
        }

        if (!folder.sessionIds.includes(session.id)) {
          addSessionToFolder(scopeKey, folder.id, session.id);
          folder = { ...folder, sessionIds: [...folder.sessionIds, session.id] };
          folderByName.set(key, folder);
        }
      });

      cleanupSessions(scopeKey, sessionIds);

      const latestScopeFolders = useSessionFoldersStore.getState().foldersMap[scopeKey] ?? [];
      if (latestScopeFolders.length >= 2) {
        defaultCollapseArchivedFolders(scopeKey, latestScopeFolders.map((f) => f.id));
      }
    });
  }, [
    normalizedProjects,
    isSessionsLoading,
    foldersMap,
    getArchivedSessionsForProject,
    createFolder,
    addSessionToFolder,
    cleanupSessions,
    defaultCollapseArchivedFolders,
  ]);
};
