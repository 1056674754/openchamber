import React from 'react';
import { normalizePath } from '@/lib/pathNormalization';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import {
  getRuntimeKey,
  subscribeRuntimeEndpointChanged,
} from '@/lib/runtime-switch';
import {
  resolveGlobalSessionDirectory,
  useGlobalSessionsStore,
} from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import {
  clearLastActiveSession,
  persistLastActiveSession,
  readLastActiveSession,
} from '@/sync/last-session-cache';
import { findLastSessionRestoreTarget } from '@/sync/last-session-restore-target';

export const useLastSessionRestore = (enabled: boolean): void => {
  const [runtimeKey, setRuntimeKey] = React.useState(() => getRuntimeKey());
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const isDraftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const activeSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const hasLoadedSessions = useGlobalSessionsStore((state) => state.hasLoaded);
  const projects = useProjectsStore((state) => state.projects);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const attemptedRuntimeRef = React.useRef<string | null>(null);

  React.useEffect(() => subscribeRuntimeEndpointChanged(({ runtimeKey: nextRuntimeKey }) => {
    attemptedRuntimeRef.current = null;
    setRuntimeKey(nextRuntimeKey);
  }), []);

  React.useEffect(() => {
    if (!enabled || !runtimeKey || !currentSessionId) return;

    const directory = useSessionUIStore.getState().getDirectoryForSession(currentSessionId) ?? null;
    const serverId = serverRegistry.getServerForSession(currentSessionId);
    if (!serverId) return;
    persistLastActiveSession(runtimeKey, {
      sessionId: currentSessionId,
      serverId,
      directory,
    });
  }, [activeSessions, currentSessionId, enabled, runtimeKey]);

  React.useEffect(() => {
    if (
      !enabled
      || !runtimeKey
      || !hasLoadedSessions
      || currentSessionId
      || isDraftOpen
      || attemptedRuntimeRef.current === runtimeKey
    ) {
      return;
    }

    attemptedRuntimeRef.current = runtimeKey;
    const persisted = readLastActiveSession(runtimeKey);
    if (!persisted) return;

    const target = findLastSessionRestoreTarget({
      persisted,
      sessions: activeSessions,
      getServerId: (session) => serverRegistry.getServerForSession(session.id) ?? null,
      getDirectory: resolveGlobalSessionDirectory,
    });
    if (!target) {
      clearLastActiveSession(runtimeKey);
      return;
    }

    const directory = resolveGlobalSessionDirectory(target) ?? persisted.directory;
    const normalizedDirectory = normalizePath(directory);
    const matchingProject = projects
      .filter((project) => (project.serverId ?? DEFAULT_SERVER_ID) === persisted.serverId)
      .filter((project) => {
        const projectPath = normalizePath(project.path);
        if (!normalizedDirectory || !projectPath) return false;
        return normalizedDirectory === projectPath || normalizedDirectory.startsWith(`${projectPath}/`);
      })
      .sort((left, right) => right.path.length - left.path.length)[0];

    if (matchingProject) setActiveProjectIdOnly(matchingProject.id);
    serverRegistry.indexSession(target.id, persisted.serverId);
    setCurrentSession(target.id, directory, { serverId: persisted.serverId });
  }, [
    activeSessions,
    currentSessionId,
    enabled,
    hasLoadedSessions,
    isDraftOpen,
    projects,
    runtimeKey,
    setActiveProjectIdOnly,
    setCurrentSession,
  ]);
};
