import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { dedupeSessionsById, normalizePath } from '../utils';
import { getProjectIdForSession, type ProjectForOwnership } from '@/lib/sessionOwnership';
import type { WorktreeMetadata } from '@/types/worktree';

type Args = {
  isVSCode: boolean;
  sessions: Session[];
  archivedSessions: Session[];
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
  normalizedProjects: ProjectForOwnership[];
  bindings: Map<string, string>;
};

const isSubtaskSession = (session: Session): boolean => {
  return Boolean((session as Session & { parentID?: string | null }).parentID);
};

const getParentID = (session: Session): string | null => {
  const parentID = (session as Session & { parentID?: string | null }).parentID;
  return typeof parentID === 'string' && parentID.trim().length > 0 ? parentID : null;
};

const hasOwnDirectory = (session: Session): boolean => {
  return Boolean(normalizePath((session as Session & { directory?: string | null }).directory ?? null));
};

const addSessionToProjectMap = (map: Map<string, Session[]>, projectId: string | null, session: Session): void => {
  if (!projectId) return;
  const list = map.get(projectId) ?? [];
  list.push(session);
  map.set(projectId, list);
};

export const useProjectSessionLists = (args: Args) => {
  const {
    isVSCode,
    sessions,
    archivedSessions,
    availableWorktreesByProject,
    normalizedProjects,
    bindings,
  } = args;

  const projectIdBySessionId = React.useMemo(() => {
    const allSessions = dedupeSessionsById([...sessions, ...archivedSessions]);
    const sessionById = new Map(allSessions.map((session) => [session.id, session]));
    const directProjectCache = new Map<string, string | null>();
    const treeProjectCache = new Map<string, string | null>();

    const getDirectProjectId = (session: Session): string | null => {
      if (directProjectCache.has(session.id)) {
        return directProjectCache.get(session.id) ?? null;
      }
      const projectId = getProjectIdForSession(session, normalizedProjects, availableWorktreesByProject, bindings);
      directProjectCache.set(session.id, projectId);
      return projectId;
    };

    const resolveTreeProjectId = (session: Session, visiting = new Set<string>()): string | null => {
      if (treeProjectCache.has(session.id)) {
        return treeProjectCache.get(session.id) ?? null;
      }

      if (visiting.has(session.id)) {
        return getDirectProjectId(session);
      }

      visiting.add(session.id);
      const parentID = getParentID(session);
      const parentSession = parentID ? sessionById.get(parentID) : undefined;
      const inheritedProjectId = parentSession ? resolveTreeProjectId(parentSession, visiting) : null;
      const projectId = inheritedProjectId ?? getDirectProjectId(session);
      visiting.delete(session.id);

      treeProjectCache.set(session.id, projectId);
      return projectId;
    };

    for (const session of allSessions) {
      resolveTreeProjectId(session);
    }

    return treeProjectCache;
  }, [sessions, archivedSessions, normalizedProjects, availableWorktreesByProject, bindings]);

  const liveByProjectId = React.useMemo(() => {
    const result = new Map<string, Session[]>();
    sessions.forEach((session) => {
      if (!hasOwnDirectory(session) && !isSubtaskSession(session)) return;
      addSessionToProjectMap(result, projectIdBySessionId.get(session.id) ?? null, session);
    });
    return result;
  }, [sessions, projectIdBySessionId]);

  const archivedByProjectId = React.useMemo(() => {
    const result = new Map<string, Session[]>();
    archivedSessions.forEach((session) => {
      if (isSubtaskSession(session)) return;
      addSessionToProjectMap(result, projectIdBySessionId.get(session.id) ?? null, session);
    });
    sessions.forEach((session) => {
      if (session.time?.archived) return;
      if (hasOwnDirectory(session)) return;
      if (isSubtaskSession(session)) return;
      addSessionToProjectMap(result, projectIdBySessionId.get(session.id) ?? null, session);
    });
    result.forEach((list, key) => {
      result.set(key, dedupeSessionsById(list));
    });
    return result;
  }, [sessions, archivedSessions, projectIdBySessionId]);

  const getSessionsForProject = React.useCallback(
    (project: { id: string }) => liveByProjectId.get(project.id) ?? [],
    [liveByProjectId],
  );

  const getArchivedSessionsForProject = React.useCallback(
    (project: { id: string }) => archivedByProjectId.get(project.id) ?? [],
    [archivedByProjectId],
  );

  void isVSCode;

  return {
    getSessionsForProject,
    getArchivedSessionsForProject,
  };
};
