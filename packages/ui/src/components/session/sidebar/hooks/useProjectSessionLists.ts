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

const hasOwnDirectory = (session: Session): boolean => {
  return Boolean(normalizePath((session as Session & { directory?: string | null }).directory ?? null));
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

  const liveByProjectId = React.useMemo(() => {
    const result = new Map<string, Session[]>();
    sessions.forEach((session) => {
      if (!hasOwnDirectory(session)) return;
      const projectId = getProjectIdForSession(session, normalizedProjects, availableWorktreesByProject, bindings);
      if (!projectId) return;
      const list = result.get(projectId) ?? [];
      list.push(session);
      result.set(projectId, list);
    });
    return result;
  }, [sessions, normalizedProjects, availableWorktreesByProject, bindings]);

  const archivedByProjectId = React.useMemo(() => {
    const result = new Map<string, Session[]>();
    const visit = (session: Session, includeUnassignedLive: boolean) => {
      if (isSubtaskSession(session) && !includeUnassignedLive) return;
      const projectId = getProjectIdForSession(session, normalizedProjects, availableWorktreesByProject, bindings);
      if (!projectId) return;
      const list = result.get(projectId) ?? [];
      list.push(session);
      result.set(projectId, list);
    };
    archivedSessions.forEach((session) => visit(session, false));
    sessions.forEach((session) => {
      if (session.time?.archived) return;
      if (hasOwnDirectory(session)) return;
      visit(session, true);
    });
    result.forEach((list, key) => {
      result.set(key, dedupeSessionsById(list));
    });
    return result;
  }, [sessions, archivedSessions, normalizedProjects, availableWorktreesByProject, bindings]);

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
