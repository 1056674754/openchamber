import React from 'react';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { RuntimeAPIProvider } from '@/contexts/RuntimeAPIProvider';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { MiniChatLayout } from '@/components/mini-chat/MiniChatLayout';
import { usePushVisibilityBeacon } from '@/hooks/usePushVisibilityBeacon';
import { useSessionPresenceBeacon } from '@/hooks/useSessionPresenceBeacon';
import { useWindowTitle } from '@/hooks/useWindowTitle';
import { opencodeClient } from '@/lib/opencode/client';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { isElectronShell } from '@/lib/desktop';
import type { RuntimeAPIs } from '@/lib/api/types';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useGitStore } from '@/stores/useGitStore';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { SyncProvider, useSessions } from '@/sync/sync-context';
import { MultiServerSyncLayer } from '@/sync/MultiServerSyncLayer';
import { RemoteProjectDiscovery } from '@/sync/RemoteProjectDiscovery';
import { SyncRuntimeEffects } from './AppEffects';
import { useAppFontEffects } from './useAppFontEffects';
import { useMiniChatKeyboardShortcuts } from '@/hooks/useMiniChatKeyboardShortcuts';
import { listProjectWorktrees } from '@/lib/worktrees/worktreeManager';
import { checkIsGitRepository, isLinkedWorktree } from '@/lib/gitApi';
import type { WorktreeMetadata } from '@/types/worktree';
import { mapWithConcurrency } from '@/lib/concurrency';
import {
  buildWorktreeDiscoveryQueue,
  mergeProjectWorktreeResult,
  pruneWorktreesForDiscoveryQueue,
  sameWorktreeList,
  sameWorktreesByProject,
} from '@/components/session/sidebar/worktreeDiscovery';

const MINI_CHAT_PRESENCE_CHANNEL = 'openchamber:mini-chat-presence';
const WORKTREE_DISCOVERY_CONCURRENCY = 3;

type MiniChatMode = 'session' | 'draft';

type MiniChatConfig = {
  mode: MiniChatMode;
  sessionId: string | null;
  directory: string | null;
  projectId: string | null;
};

type ElectronMiniChatAppProps = {
  apis: RuntimeAPIs;
};

type ProjectEntry = {
  path: string;
  serverId?: string;
};

const normalizeDirectoryKey = (path: string | null | undefined): string | null => {
  if (!path) return null;
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
};

const resolveProjectServerId = (projects: readonly ProjectEntry[], directory: string | null | undefined): string | null => {
  const normalizedDirectory = normalizeDirectoryKey(directory);
  if (!normalizedDirectory) return null;

  let best: ProjectEntry | null = null;
  for (const project of projects) {
    const normalizedProjectPath = normalizeDirectoryKey(project.path);
    if (!normalizedProjectPath) continue;
    if (normalizedDirectory !== normalizedProjectPath && !normalizedDirectory.startsWith(`${normalizedProjectPath}/`)) {
      continue;
    }
    if (!best || normalizedProjectPath.length > (normalizeDirectoryKey(best.path)?.length ?? 0)) {
      best = project;
    }
  }

  return best?.serverId ?? null;
};

const useDirectoryServerReady = (directory: string | null | undefined): boolean => {
  const projects = useProjectsStore((state) => state.projects);
  const sshInitialized = useDesktopSshStore((state) => state.initialized);
  const sshStatuses = useDesktopSshStore((state) => state.statusesById);

  return React.useMemo(() => {
    const serverId = resolveProjectServerId(projects, directory);
    if (!serverId || serverId === DEFAULT_SERVER_ID) return true;
    if (serverRegistry.get(serverId)) return true;
    if (!sshInitialized) return false;
    const status = sshStatuses[serverId];
    return status?.phase === 'ready' && Boolean(status.localUrl) && Boolean(serverRegistry.get(serverId));
  }, [directory, projects, sshInitialized, sshStatuses]);
};

const readMiniChatConfig = (): MiniChatConfig => {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const mode = params.get('mode') === 'session' ? 'session' : 'draft';
  const sessionId = params.get('sessionId')?.trim() || null;
  const directory = params.get('directory')?.trim() || null;
  const projectId = params.get('projectId')?.trim() || null;
  return { mode, sessionId, directory, projectId };
};

const MiniChatBootstrap: React.FC<{ config: MiniChatConfig }> = ({ config }) => {
  const sessions = useSessions();
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);
  const projects = useProjectsStore((state) => state.projects);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const draftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const draftDirectory = useSessionUIStore((state) => {
    if (!state.newSessionDraft?.open) return '';
    return state.newSessionDraft.bootstrapPendingDirectory ?? state.newSessionDraft.directoryOverride ?? '';
  });
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const initializeApp = useConfigStore((state) => state.initializeApp);
  const isInitialized = useConfigStore((state) => state.isInitialized);
  const isConnected = useConfigStore((state) => state.isConnected);
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const loadAgents = useConfigStore((state) => state.loadAgents);
  const providersCount = useConfigStore((state) => state.providers.length);
  const agentsCount = useConfigStore((state) => state.agents.length);
  const targetDirectoryServerReady = useDirectoryServerReady(config.directory);

  React.useEffect(() => {
    if (!isElectronShell()) return;
    void useDesktopSshStore.getState().load();
  }, []);

  React.useEffect(() => {
    void initializeApp();
  }, [initializeApp]);

  React.useEffect(() => {
    if (isInitialized) return;
    let active = true;
    let retryCount = 0;
    const id = window.setInterval(() => {
      if (!active) return;
      retryCount += 1;
      if (retryCount > 10) {
        window.clearInterval(id);
        return;
      }
      if (!useConfigStore.getState().isInitialized) {
        void useConfigStore.getState().initializeApp();
      }
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [isInitialized]);

  const directoryBootstrappedRef = React.useRef(false);
  React.useEffect(() => {
    if (directoryBootstrappedRef.current) return;
    if (config.mode !== 'session') return;
    if (!config.directory) return;
    if (currentDirectory === config.directory) {
      directoryBootstrappedRef.current = true;
      return;
    }
    setDirectory(config.directory, { showOverlay: false });
    directoryBootstrappedRef.current = true;
  }, [config.directory, config.mode, currentDirectory, setDirectory]);

  React.useEffect(() => {
    if (config.mode !== 'draft' || !draftOpen || currentSessionId) return;
    if (!draftDirectory || currentDirectory === draftDirectory) return;
    setDirectory(draftDirectory, { showOverlay: false });
  }, [config.mode, currentDirectory, currentSessionId, draftDirectory, draftOpen, setDirectory]);

  React.useEffect(() => {
    if (!isConnected) return;
    if (!targetDirectoryServerReady) return;
    if (providersCount === 0) void loadProviders();
    if (agentsCount === 0) void loadAgents();
  }, [agentsCount, isConnected, loadAgents, loadProviders, providersCount, targetDirectoryServerReady]);

  const sessionBootstrappedRef = React.useRef(false);
  React.useEffect(() => {
    if (sessionBootstrappedRef.current) return;
    if (config.mode !== 'session' || !config.sessionId) return;
    if (!isInitialized || !targetDirectoryServerReady) return;
    if (currentSessionId === config.sessionId) {
      sessionBootstrappedRef.current = true;
      return;
    }
    if (currentSessionId) {
      // User already has a different session selected (e.g. from a prior switch); don't override.
      sessionBootstrappedRef.current = true;
      return;
    }
    const session = sessions.find((entry) => entry.id === config.sessionId);
    const directory = (session as { directory?: string | null } | undefined)?.directory ?? config.directory;
    if (!directory) return;
    setCurrentSession(config.sessionId, directory);
    sessionBootstrappedRef.current = true;
  }, [config, currentSessionId, isInitialized, sessions, setCurrentSession, targetDirectoryServerReady]);

  React.useEffect(() => {
    if (config.mode !== 'draft' || draftOpen || currentSessionId) return;
    openNewSessionDraft({
      selectedProjectId: config.projectId,
      directoryOverride: config.directory,
      preserveDirectoryOverride: Boolean(config.directory),
    });
  }, [config, currentSessionId, draftOpen, openNewSessionDraft]);

  React.useEffect(() => {
    if (projects.length === 0) return;
    let cancelled = false;

    const projectQueue = buildWorktreeDiscoveryQueue(projects);
    const orderedProjectKeys = projectQueue.map((entry) => entry.discoveryKey);

    if (projectQueue.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const publishWorktreeResult = (
      project: ReturnType<typeof buildWorktreeDiscoveryQueue>[number],
      worktrees: WorktreeMetadata[],
    ) => {
      if (cancelled) return;

      useSessionUIStore.setState((state) => {
        const currentProjectWorktrees = state.availableWorktreesByProject.get(project.discoveryKey) ?? [];
        const legacyProjectHasWorktrees = project.legacyDiscoveryKey !== project.discoveryKey
          && state.availableWorktreesByProject.has(project.legacyDiscoveryKey);

        const merged = mergeProjectWorktreeResult({
          currentByProject: state.availableWorktreesByProject,
          projectKey: project.discoveryKey,
          legacyProjectKey: project.legacyDiscoveryKey,
          worktrees,
          orderedProjectKeys,
        });

        if (
          !legacyProjectHasWorktrees
          && sameWorktreeList(currentProjectWorktrees, worktrees)
          && sameWorktreeList(state.availableWorktrees, merged.allWorktrees)
        ) {
          return state;
        }

        return {
          availableWorktrees: merged.allWorktrees,
          availableWorktreesByProject: merged.byProject,
        };
      });
    };

    useSessionUIStore.setState((state) => {
      const pruned = pruneWorktreesForDiscoveryQueue(state.availableWorktreesByProject, projectQueue);
      if (
        sameWorktreesByProject(state.availableWorktreesByProject, pruned.byProject)
        && sameWorktreeList(state.availableWorktrees, pruned.allWorktrees)
      ) {
        return state;
      }
      return {
        availableWorktrees: pruned.allWorktrees,
        availableWorktreesByProject: pruned.byProject,
      };
    });

    const discoverWorktrees = async () => {
      await mapWithConcurrency(projectQueue, WORKTREE_DISCOVERY_CONCURRENCY, async (project) => {
        const projectPath = project.normalizedPath;
        if (!projectPath) return;
        try {
          const serverId = project.serverId && project.serverId !== DEFAULT_SERVER_ID ? project.serverId : null;
          const cachedIsGitRepo = serverId ? undefined : useGitStore.getState().directories.get(projectPath)?.isGitRepo;
          const isGitRepo = cachedIsGitRepo === false && !serverId
            ? false
            : cachedIsGitRepo === true || await checkIsGitRepository(projectPath);
          if (!isGitRepo) {
            publishWorktreeResult(project, []);
            return;
          }
          if (await isLinkedWorktree(projectPath).catch(() => false)) {
            publishWorktreeResult(project, []);
            return;
          }
          const worktrees = await listProjectWorktrees({
            id: project.id,
            path: projectPath,
            serverId: project.serverId,
            label: project.label,
          });
          publishWorktreeResult(project, worktrees);
        } catch {
          // Worktree discovery is best-effort; draft selector falls back to the project root.
        }
      });
    };

    void discoverWorktrees();

    return () => {
      cancelled = true;
    };
  }, [projects]);

  return null;
};

const MiniChatPresencePublisher: React.FC = () => {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);

  React.useEffect(() => {
    if (!currentSessionId || !currentDirectory || typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(MINI_CHAT_PRESENCE_CHANNEL);
    const postPresence = (viewed: boolean) => {
      channel.postMessage({
        type: 'mini-chat-session-presence',
        sessionId: currentSessionId,
        directory: currentDirectory,
        viewed,
      });
    };

    postPresence(true);
    const interval = window.setInterval(() => postPresence(true), 5_000);
    const handleBeforeUnload = () => postPresence(false);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      postPresence(false);
      channel.close();
    };
  }, [currentDirectory, currentSessionId]);

  return null;
};

const useSessionUnavailable = (config: MiniChatConfig): boolean => {
  const sessions = useSessions();
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const targetDirectoryServerReady = useDirectoryServerReady(config.directory);
  const [timedOut, setTimedOut] = React.useState(false);

  React.useEffect(() => {
    if (config.mode !== 'session' || !config.sessionId || currentSessionId === config.sessionId || !targetDirectoryServerReady) {
      setTimedOut(false);
      return;
    }
    if (sessions.some((entry) => entry.id === config.sessionId)) {
      setTimedOut(false);
      return;
    }
    const timeout = window.setTimeout(() => setTimedOut(true), 5000);
    return () => window.clearTimeout(timeout);
  }, [config.mode, config.sessionId, currentSessionId, sessions, targetDirectoryServerReady]);

  return timedOut;
};

export function ElectronMiniChatApp({ apis }: ElectronMiniChatAppProps) {
  const config = React.useMemo(() => readMiniChatConfig(), []);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const syncDirectory = config.directory || currentDirectory;

  React.useEffect(() => {
    opencodeClient.setDirectory(syncDirectory || undefined);
  }, [syncDirectory]);

  React.useEffect(() => {
    registerRuntimeAPIs(apis);
    return () => registerRuntimeAPIs(null);
  }, [apis]);

  useAppFontEffects();
  useMiniChatKeyboardShortcuts();
  usePushVisibilityBeacon({ enabled: true });
  useWindowTitle();

  return (
    <ErrorBoundary>
      <SyncProvider sdk={opencodeClient.getSdkClient()} directory={syncDirectory || ''}>
        <MultiServerSyncLayer />
        <RemoteProjectDiscovery />
        <RuntimeAPIProvider apis={apis}>
          <TooltipProvider delayDuration={300} skipDelayDuration={150}>
            <div className="h-full text-foreground bg-background">
              <ElectronMiniChatContent config={config} />
              <Toaster />
            </div>
          </TooltipProvider>
        </RuntimeAPIProvider>
      </SyncProvider>
    </ErrorBoundary>
  );
}

const ElectronMiniChatContent: React.FC<{ config: MiniChatConfig }> = ({ config }) => {
  useSessionPresenceBeacon();
  const sessionUnavailable = useSessionUnavailable(config);

  return (
    <>
      <MiniChatBootstrap config={config} />
      <MiniChatPresencePublisher />
      <SyncRuntimeEffects embeddedBackgroundWorkEnabled={true} />
      <MiniChatLayout mode={config.mode} autoOpenDraft={config.mode === 'draft'} unavailable={sessionUnavailable} />
    </>
  );
};
