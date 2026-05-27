import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import type { SessionGroup, SessionNode } from '../types';
import { normalizePath } from '../utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

type ProjectSection = {
  project: { id: string; normalizedPath: string; serverId?: string };
  groups: SessionGroup[];
};

const normalizeServerId = (serverId?: string | null): string =>
  serverId && serverId !== DEFAULT_SERVER_ID ? serverId : DEFAULT_SERVER_ID;

type Args = {
  projectSections: ProjectSection[];
  activeProjectId: string | null;
  setActiveSessionByProject: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  currentSessionId: string | null;
  sessions: Session[];
  worktreeMetadata: Map<string, { path?: string | null }>;
};

export const useProjectSessionSelection = (args: Args): { currentSessionDirectory: string | null } => {
  const {
    projectSections,
    activeProjectId,
    setActiveSessionByProject,
    currentSessionId,
    sessions,
    worktreeMetadata,
  } = args;

  const projectSessionMeta = React.useMemo(() => {
    const metaByProject = new Map<string, Map<string, { directory: string | null }>>();

    const visitNodes = (
      projectId: string,
      projectRoot: string,
      fallbackDirectory: string | null,
      nodes: SessionNode[],
    ) => {
      if (!metaByProject.has(projectId)) {
        metaByProject.set(projectId, new Map());
      }
      const projectMap = metaByProject.get(projectId)!;
      nodes.forEach((node) => {
        const sessionDirectory = normalizePath(
          node.worktree?.path
          ?? (node.session as Session & { directory?: string | null }).directory
          ?? fallbackDirectory
          ?? projectRoot,
        );
        projectMap.set(node.session.id, { directory: sessionDirectory });
        if (node.children.length > 0) {
          visitNodes(projectId, projectRoot, sessionDirectory, node.children);
        }
      });
    };

    projectSections.forEach((section) => {
      section.groups.forEach((group) => {
        visitNodes(section.project.id, section.project.normalizedPath, group.directory, group.sessions);
      });
    });

    return { metaByProject };
  }, [projectSections]);

  const currentSessionProject = React.useMemo(() => {
    if (!currentSessionId) {
      return null;
    }

    for (const [projectId, projectMap] of projectSessionMeta.metaByProject) {
      const match = projectMap.get(currentSessionId);
      if (match) {
        return { projectId, directory: match.directory };
      }
    }

    const metadataPath = worktreeMetadata.get(currentSessionId)?.path;
    const activeSession = sessions.find((session) => session.id === currentSessionId);
    const sessionDirectory = normalizePath(
      metadataPath
      ?? (activeSession as (Session & { directory?: string | null }) | undefined)?.directory
      ?? null,
    );
    if (!sessionDirectory) {
      return null;
    }

    const indexedServerId = serverRegistry.getServerForSession(currentSessionId);
    let best: { projectId: string; directory: string | null; pathLength: number } | null = null;

    for (const section of projectSections) {
      if (indexedServerId && normalizeServerId(section.project.serverId) !== indexedServerId) {
        continue;
      }

      const projectPath = normalizePath(section.project.normalizedPath);
      if (!projectPath) {
        continue;
      }
      if (sessionDirectory !== projectPath && !sessionDirectory.startsWith(`${projectPath}/`)) {
        continue;
      }
      if (!best || projectPath.length > best.pathLength) {
        best = {
          projectId: section.project.id,
          directory: sessionDirectory,
          pathLength: projectPath.length,
        };
      }
    }

    return best ? { projectId: best.projectId, directory: best.directory } : null;
  }, [currentSessionId, projectSections, projectSessionMeta, sessions, worktreeMetadata]);

  // Keep this hook passive. Project/sidebar state may lag while sync data
  // loads, so it must not switch sessions or open drafts as a fallback.
  React.useEffect(() => {
    if (!activeProjectId) {
      return;
    }
    const explicitTarget = useSessionUIStore.getState().consumeNavigationIntent();
    if (explicitTarget) {
      setActiveSessionByProject((prev) => {
        if (prev.get(activeProjectId) === explicitTarget) return prev;
        const next = new Map(prev);
        next.set(activeProjectId, explicitTarget);
        return next;
      });
      return;
    }
  }, [activeProjectId, currentSessionId, setActiveSessionByProject]);

  React.useEffect(() => {
    if (!currentSessionId || !currentSessionProject) {
      return;
    }
    setActiveSessionByProject((prev) => {
      if (prev.get(currentSessionProject.projectId) === currentSessionId) {
        return prev;
      }
      const next = new Map(prev);
      next.set(currentSessionProject.projectId, currentSessionId);
      return next;
    });
  }, [currentSessionId, currentSessionProject, setActiveSessionByProject]);

  React.useEffect(() => {
    if (!activeProjectId || !currentSessionId) {
      return;
    }
    const projectMap = projectSessionMeta.metaByProject.get(activeProjectId);
    if (!projectMap || !projectMap.has(currentSessionId)) {
      return;
    }
    setActiveSessionByProject((prev) => {
      if (prev.get(activeProjectId) === currentSessionId) {
        return prev;
      }
      const next = new Map(prev);
      next.set(activeProjectId, currentSessionId);
      return next;
    });
  }, [activeProjectId, currentSessionId, projectSessionMeta, setActiveSessionByProject]);

  const currentSessionDirectory = React.useMemo(() => {
    if (!currentSessionId) {
      return null;
    }
    const metadataPath = worktreeMetadata.get(currentSessionId)?.path;
    if (metadataPath) {
      return normalizePath(metadataPath) ?? metadataPath;
    }
    const activeSession = sessions.find((session) => session.id === currentSessionId);
    if (!activeSession) {
      return null;
    }
    return normalizePath((activeSession as Session & { directory?: string | null }).directory ?? null);
  }, [currentSessionId, sessions, worktreeMetadata]);

  return { currentSessionDirectory };
};
