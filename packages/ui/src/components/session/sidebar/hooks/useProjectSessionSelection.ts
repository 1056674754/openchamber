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
  activeSessionByProject: Map<string, string>;
  setActiveSessionByProject: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  currentSessionId: string | null;
  newSessionDraftOpen: boolean;
  mobileVariant: boolean;
  setActiveProjectIdOnly: (id: string) => void;
  openNewSessionDraft: (options?: { directoryOverride?: string | null; selectedProjectId?: string | null }) => void;
  setActiveMainTab: (tab: 'chat' | 'plan' | 'git' | 'diff' | 'terminal' | 'files') => void;
  setSessionSwitcherOpen: (open: boolean) => void;
  sessions: Session[];
  worktreeMetadata: Map<string, { path?: string | null }>;
};

export const useProjectSessionSelection = (args: Args): { currentSessionDirectory: string | null } => {
  const {
    projectSections,
    activeProjectId,
    activeSessionByProject,
    setActiveSessionByProject,
    currentSessionId,
    newSessionDraftOpen,
    mobileVariant,
    setActiveProjectIdOnly,
    openNewSessionDraft,
    setActiveMainTab,
    setSessionSwitcherOpen,
    sessions,
    worktreeMetadata,
  } = args;

  const projectSessionMeta = React.useMemo(() => {
    const metaByProject = new Map<string, Map<string, { directory: string | null }>>();
    const firstSessionByProject = new Map<string, { id: string; directory: string | null }>();

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
        if (!firstSessionByProject.has(projectId)) {
          firstSessionByProject.set(projectId, { id: node.session.id, directory: sessionDirectory });
        }
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

    return { metaByProject, firstSessionByProject };
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

  const currentSessionHasDeferredOwner = React.useMemo(() => {
    if (!currentSessionId || currentSessionProject) {
      return false;
    }

    const indexedServerId = serverRegistry.getServerForSession(currentSessionId);
    if (indexedServerId && indexedServerId !== DEFAULT_SERVER_ID) {
      return true;
    }

    const metadataPath = worktreeMetadata.get(currentSessionId)?.path;
    const activeSession = sessions.find((session) => session.id === currentSessionId);
    return Boolean(normalizePath(
      metadataPath
      ?? (activeSession as (Session & { directory?: string | null }) | undefined)?.directory
      ?? null,
    ));
  }, [currentSessionId, currentSessionProject, sessions, worktreeMetadata]);

  const previousActiveProjectRef = React.useRef<string | null>(null);

  React.useLayoutEffect(() => {
    if (!activeProjectId) {
      return;
    }

    if (newSessionDraftOpen) {
      return;
    }

    const previousActiveProjectId = previousActiveProjectRef.current;
    const projectChangedAfterInit = previousActiveProjectId !== null && previousActiveProjectId !== activeProjectId;

    const selectedSessionId = currentSessionId;
    if (!projectChangedAfterInit && selectedSessionId && currentSessionProject && currentSessionProject.projectId !== activeProjectId) {
      previousActiveProjectRef.current = currentSessionProject.projectId;
      setActiveSessionByProject((prev) => {
        if (prev.get(currentSessionProject.projectId) === selectedSessionId) {
          return prev;
        }
        const next = new Map(prev);
        next.set(currentSessionProject.projectId, selectedSessionId);
        return next;
      });
      setActiveProjectIdOnly(currentSessionProject.projectId);
      return;
    }

    if (!projectChangedAfterInit && currentSessionHasDeferredOwner) {
      return;
    }

    if (previousActiveProjectId === activeProjectId) {
      return;
    }
    const section = projectSections.find((item) => item.project.id === activeProjectId);
    if (!section) {
      return;
    }
    previousActiveProjectRef.current = activeProjectId;

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

    const projectMap = projectSessionMeta.metaByProject.get(activeProjectId);

    if (currentSessionId && projectMap && projectMap.has(currentSessionId)) {
      setActiveSessionByProject((prev) => {
        if (prev.get(activeProjectId) === currentSessionId) {
          return prev;
        }
        const next = new Map(prev);
        next.set(activeProjectId, currentSessionId);
        return next;
      });
      return;
    }

    if (!projectMap || projectMap.size === 0) {
      setActiveMainTab('chat');
      if (mobileVariant) {
        setSessionSwitcherOpen(false);
      }
      openNewSessionDraft({ directoryOverride: section.project.normalizedPath, selectedProjectId: section.project.id });
      return;
    }

    const rememberedSessionId = activeSessionByProject.get(activeProjectId);
    const remembered = rememberedSessionId && projectMap.has(rememberedSessionId)
      ? rememberedSessionId
      : null;
    const fallback = projectSessionMeta.firstSessionByProject.get(activeProjectId)?.id ?? null;
    const targetSessionId = remembered ?? fallback;
    if (!targetSessionId || targetSessionId === currentSessionId) {
      return;
    }
    const targetDirectory = projectMap.get(targetSessionId)?.directory ?? null;
    if (targetDirectory) {
      useSessionUIStore.getState().navigateToSession(targetSessionId, targetDirectory, activeProjectId);
    }
  }, [
    activeProjectId,
    activeSessionByProject,
    currentSessionId,
    currentSessionProject,
    currentSessionHasDeferredOwner,
    newSessionDraftOpen,
    mobileVariant,
    openNewSessionDraft,
    projectSections,
    projectSessionMeta,
    setActiveMainTab,
    setSessionSwitcherOpen,
    setActiveSessionByProject,
    setActiveProjectIdOnly,
  ]);

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
