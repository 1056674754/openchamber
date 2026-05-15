import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { RiLayoutLeftLine } from '@remixicon/react';
import { toast } from '@/components/ui';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { useDeviceInfo, useTabletStandalonePwaRuntime } from '@/lib/device';
import { isDesktopShell } from '@/lib/desktop';
import { isDesktopWindowFullscreen as getDesktopWindowFullscreen, onDesktopWindowResized, startDesktopWindowDrag } from '@/lib/desktopNative';
import { sessionEvents } from '@/lib/sessionEvents';
import { formatDirectoryName, cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllServersLiveSessions, useAllServersSessionStatuses } from '@/sync/multi-server-hooks';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useSync } from '@/sync/use-sync';
import { useSessionPrefetch } from './sidebar/hooks/useSessionPrefetch';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import { useGitStore, useGitAllBranches, useGitRepoStatusMap } from '@/stores/useGitStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { NewWorktreeDialog } from './NewWorktreeDialog';
import { ScheduledTasksDialog } from './ScheduledTasksDialog';
import { RegenerateTitleDialog } from './RegenerateTitleDialog';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useArchivedAutoFolders } from './sidebar/hooks/useArchivedAutoFolders';
import { useSessionSidebarSections } from './sidebar/hooks/useSessionSidebarSections';
import { useProjectSessionSelection } from './sidebar/hooks/useProjectSessionSelection';
import { useGroupOrdering } from './sidebar/hooks/useGroupOrdering';
import { useSessionGrouping } from './sidebar/hooks/useSessionGrouping';
import { useSessionSearchEffects } from './sidebar/hooks/useSessionSearchEffects';
import { useSessionActions } from './sidebar/hooks/useSessionActions';
import { useSidebarPersistence } from './sidebar/hooks/useSidebarPersistence';
import { useProjectRepoStatus } from './sidebar/hooks/useProjectRepoStatus';
import { useProjectSessionLists } from './sidebar/hooks/useProjectSessionLists';
import { useSessionFolderCleanup } from './sidebar/hooks/useSessionFolderCleanup';
import { useStickyProjectHeaders } from './sidebar/hooks/useStickyProjectHeaders';
import { getGitHubPrStatusKey, usePrVisualSummaryByKeys, useGitHubPrStatusStore } from '@/stores/useGitHubPrStatusStore';
import { ProjectEditDialog } from '@/components/layout/ProjectEditDialog';
import { UpdateDialog } from '@/components/ui/UpdateDialog';
import { SessionGroupSection } from './sidebar/SessionGroupSection';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { SidebarActivitySections, type ActivitySection } from './sidebar/SidebarActivitySections';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarProjectsList } from './sidebar/SidebarProjectsList';
import { SessionNodeItem } from './sidebar/SessionNodeItem';
import { TempSessionsSection, type TempSessionEntry } from './sidebar/TempSessionsSection';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useShallow } from 'zustand/react/shallow';
import { listProjectWorktrees } from '@/lib/worktrees/worktreeManager';
import type { WorktreeMetadata } from '@/types/worktree';
import type { SortableDragHandleProps } from './sidebar/sortableItems';
import { listTempSessions, deleteTempSession } from '@/lib/tempSessions';
import {
  BulkSessionDeleteConfirmDialog,
  FolderDeleteConfirmDialog,
  SessionDeleteConfirmDialog,
  type BulkDeleteSessionsConfirmState,
  type DeleteFolderConfirmState,
  type DeleteSessionConfirmState,
} from './sidebar/ConfirmDialogs';
import { BulkActionBar } from './sidebar/BulkActionBar';
import { useSessionMultiSelectStore } from '@/stores/useSessionMultiSelectStore';
import { useSessionDisplayStore } from '@/stores/useSessionDisplayStore';
import { type SessionGroup, type SessionNode } from './sidebar/types';
import {
  type ActiveNowEntry,
  addActiveNowSession,
  deriveActiveNowSessions,
  deriveLiveActiveNowSessions,
  persistActiveNowEntries,
  pruneActiveNowEntries,
  readActiveNowEntries,
} from './sidebar/activitySections';
import {
  compareSessions,
  formatProjectLabel,
  normalizePath,
} from './sidebar/utils';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useSessionProjectStore } from '@/stores/useSessionProjectStore';
import { hydrateSessionProjectBindings } from '@/lib/sessionOwnership';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

const PROJECT_COLLAPSE_STORAGE_KEY = 'oc.sessions.projectCollapse';
const GROUP_ORDER_STORAGE_KEY = 'oc.sessions.groupOrder';
const GROUP_COLLAPSE_STORAGE_KEY = 'oc.sessions.groupCollapse';
const PROJECT_ACTIVE_SESSION_STORAGE_KEY = 'oc.sessions.activeSessionByProject';
const SESSION_EXPANDED_STORAGE_KEY = 'oc.sessions.expandedParents';
const SESSION_PINNED_STORAGE_KEY = 'oc.sessions.pinned';
const SESSION_PINNED_PER_PROJECT_STORAGE_KEY = 'oc.sessions.pinnedByProject';
const SESSION_PINNED_ORDER_STORAGE_KEY = 'oc.sessions.pinnedOrder';
const SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY = 'oc.sessions.pinnedOrderByProject';

type PrVisualState = 'draft' | 'open' | 'blocked' | 'merged' | 'closed';

type PrIndicator = {
  visualState: PrVisualState;
  number: number;
  url: string | null;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  title: string | null;
  base: string | null;
  head: string | null;
  checks: {
    state: 'success' | 'failure' | 'pending' | 'unknown';
    total: number;
    success: number;
    failure: number;
    pending: number;
  } | null;
  canMerge: boolean | null;
  mergeableState: string | null;
  repo: {
    owner: string;
    repo: string;
  } | null;
};

const directoryBelongsToProject = (directory: string | null | undefined, projectPath: string): boolean => {
  const normalizedDirectory = normalizePath(directory ?? null);
  const normalizedProjectPath = normalizePath(projectPath);
  if (!normalizedDirectory || !normalizedProjectPath) return false;
  return normalizedDirectory === normalizedProjectPath || normalizedDirectory.startsWith(`${normalizedProjectPath}/`);
};

const buildKnownSessionDirectories = (
  projects: Array<{ path: string }>,
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
): Set<string> => {
  const directories = new Set<string>();
  for (const project of projects) {
    const normalized = normalizePath(project.path)?.toLowerCase();
    if (normalized) directories.add(normalized);
  }
  for (const worktrees of availableWorktreesByProject.values()) {
    for (const worktree of worktrees) {
      const normalized = normalizePath(worktree.path)?.toLowerCase();
      if (normalized) directories.add(normalized);
    }
  }
  return directories;
};

const isKnownActiveSessionDirectory = (session: Session, knownDirectories: Set<string>): boolean => {
  if (session.time?.archived) return true;
  const directory = normalizePath(resolveGlobalSessionDirectory(session))?.toLowerCase();
  if (!directory) return true;
  if (knownDirectories.size === 0) return true;
  return knownDirectories.has(directory);
};

const SIDEBAR_PR_NO_PR_RETRY_MS = 5 * 60_000;

interface SessionSidebarProps {
  mobileVariant?: boolean;
  onSessionSelected?: (sessionId: string) => void;
  allowReselect?: boolean;
  hideDirectoryControls?: boolean;
  showOnlyMainWorkspace?: boolean;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  mobileVariant = false,
  onSessionSelected,
  allowReselect = false,
  hideDirectoryControls = false,
  showOnlyMainWorkspace = false,
}) => {
  const { t } = useI18n();
  const [isSessionSearchOpen, setIsSessionSearchOpen] = React.useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState('');
  const sessionSearchContainerRef = React.useRef<HTMLDivElement | null>(null);
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const retriedNoPrStatusKeysRef = React.useRef<Set<string>>(new Set());
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState('');
  const [editingProjectDialogId, setEditingProjectDialogId] = React.useState<string | null>(null);
  const [expandedParents, setExpandedParents] = React.useState<Set<string>>(new Set());
  const [directoryStatus] = React.useState<Map<string, 'unknown' | 'exists' | 'missing'>>(
    () => new Map(),
  );
  const safeStorage = React.useMemo(() => getSafeStorage(), []);
  const [activeNowEntries, setActiveNowEntries] = React.useState<ActiveNowEntry[]>(() => readActiveNowEntries(safeStorage));
  const [collapsedProjects, setCollapsedProjects] = React.useState<Set<string>>(new Set());

  const [projectRepoStatus, setProjectRepoStatus] = React.useState<Map<string, boolean | null>>(new Map());
  const [expandedSessionGroups, setExpandedSessionGroups] = React.useState<Set<string>>(new Set());
  const [newWorktreeDialogOpen, setNewWorktreeDialogOpen] = React.useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
  const [openSidebarMenuKey, setOpenSidebarMenuKey] = React.useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = React.useState('');
  const [deleteSessionConfirm, setDeleteSessionConfirm] = React.useState<DeleteSessionConfirmState>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = React.useState<DeleteFolderConfirmState>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = React.useState<BulkDeleteSessionsConfirmState>(null);
  const [regenerateTitleSession, setRegenerateTitleSession] = React.useState<{ id: string; title: string } | null>(null);
  const [pinnedSessionIds, setPinnedSessionIds] = React.useState<Set<string>>(() => {
    try {
      const raw = getSafeStorage().getItem(SESSION_PINNED_STORAGE_KEY);
      if (!raw) {
        return new Set();
      }
      const parsed = JSON.parse(raw) as string[];
      return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [pinnedSessionIdsByProject, setPinnedSessionIdsByProject] = React.useState<Map<string, Set<string>>>(() => {
    try {
      const raw = getSafeStorage().getItem(SESSION_PINNED_PER_PROJECT_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        return new Map();
      }
      const map = new Map<string, Set<string>>();
      for (const [key, ids] of Object.entries(parsed)) {
        if (Array.isArray(ids)) {
          map.set(key, new Set(ids.filter((item) => typeof item === 'string')));
        }
      }
      return map;
    } catch {
      return new Map();
    }
  });
  const [pinnedOrder, setPinnedOrder] = React.useState<string[]>(() => {
    try {
      const raw = getSafeStorage().getItem(SESSION_PINNED_ORDER_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [pinnedOrderByProject, setPinnedOrderByProject] = React.useState<Map<string, string[]>>(() => {
    try {
      const raw = getSafeStorage().getItem(SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY);
      if (!raw) return new Map();
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      const map = new Map<string, string[]>();
      for (const [key, order] of Object.entries(parsed)) {
        if (Array.isArray(order)) {
          map.set(key, order.filter((item) => typeof item === 'string'));
        }
      }
      return map;
    } catch {
      return new Map();
    }
  });
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
    try {
      const raw = getSafeStorage().getItem(GROUP_COLLAPSE_STORAGE_KEY);
      if (!raw) {
        return new Set();
      }
      const parsed = JSON.parse(raw) as string[];
      return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [tempSessions, setTempSessions] = React.useState<TempSessionEntry[]>([]);
  const [tempSessionsCollapsed, setTempSessionsCollapsed] = React.useState(() => {
    try {
      const raw = getSafeStorage().getItem('oc.tempSessions.collapsed');
      return raw === 'true';
    } catch {
      return false;
    }
  });
  const [groupOrderByProject, setGroupOrderByProject] = React.useState<Map<string, string[]>>(() => {
    try {
      const raw = getSafeStorage().getItem(GROUP_ORDER_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const next = new Map<string, string[]>();
      Object.entries(parsed).forEach(([projectId, order]) => {
        if (Array.isArray(order)) {
          next.set(projectId, order.filter((item) => typeof item === 'string'));
        }
      });
      return next;
    } catch {
      return new Map();
    }
  });
  const [activeSessionByProject, setActiveSessionByProject] = React.useState<Map<string, string>>(() => {
    try {
      const raw = getSafeStorage().getItem(PROJECT_ACTIVE_SESSION_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      const next = new Map<string, string>();
      Object.entries(parsed).forEach(([projectId, sessionId]) => {
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          next.set(projectId, sessionId);
        }
      });
      return next;
    } catch {
      return new Map();
    }
  });

  const [projectRootBranches, setProjectRootBranches] = React.useState<Map<string, string>>(new Map());
  const projectHeaderSentinelRefs = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
  const ignoreIntersectionUntil = React.useRef<number>(0);

  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);

  const projects = useProjectsStore((state) => state.projects);
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const updateProjectMeta = useProjectsStore((state) => state.updateProjectMeta);
  const reorderProjects = useProjectsStore((state) => state.reorderProjects);
  const toggleProjectPin = useProjectsStore((state) => state.toggleProjectPin);
  const setActiveMainTab = useUIStore((state) => state.setActiveMainTab);
  const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const toggleHelpDialog = useUIStore((state) => state.toggleHelpDialog);
  const setAboutDialogOpen = useUIStore((state) => state.setAboutDialogOpen);
  const setSessionSwitcherOpen = useUIStore((state) => state.setSessionSwitcherOpen);
  const setScheduledTasksDialogOpen = useUIStore((state) => state.setScheduledTasksDialogOpen);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const openMultiRunLauncher = useUIStore((state) => state.openMultiRunLauncher);
const multiRunEnabled = useUIStore((state) => state.multiRunEnabled);
  const notifyOnSubtasks = useUIStore((state) => state.notifyOnSubtasks);
  const showDeletionDialog = useUIStore((state) => state.showDeletionDialog);
  const setShowDeletionDialog = useUIStore((state) => state.setShowDeletionDialog);
  const sessionSortMode = useUIStore((state) => state.sessionSortMode);

  const debouncedSessionSearchQuery = useDebouncedValue(sessionSearchQuery, 120);
  const normalizedSessionSearchQuery = React.useMemo(
    () => debouncedSessionSearchQuery.trim().toLowerCase(),
    [debouncedSessionSearchQuery],
  );

  const hasSessionSearchQuery = normalizedSessionSearchQuery.length > 0;

  // Session Folders store
  const collapsedFolderIds = useSessionFoldersStore((state) => state.collapsedFolderIds);
  const foldersMap = useSessionFoldersStore((state) => state.foldersMap);
  const getFoldersForScope = useSessionFoldersStore((state) => state.getFoldersForScope);
  const createFolder = useSessionFoldersStore((state) => state.createFolder);
  const renameFolder = useSessionFoldersStore((state) => state.renameFolder);
  const deleteFolder = useSessionFoldersStore((state) => state.deleteFolder);
  const addSessionToFolder = useSessionFoldersStore((state) => state.addSessionToFolder);
  const addSessionsToFolder = useSessionFoldersStore((state) => state.addSessionsToFolder);
  const removeSessionFromFolder = useSessionFoldersStore((state) => state.removeSessionFromFolder);
  const removeSessionsFromFolders = useSessionFoldersStore((state) => state.removeSessionsFromFolders);
  const toggleFolderCollapse = useSessionFoldersStore((state) => state.toggleFolderCollapse);
  const cleanupSessions = useSessionFoldersStore((state) => state.cleanupSessions);
  const getSessionFolderId = useSessionFoldersStore((state) => state.getSessionFolderId);

  useSessionSearchEffects({
    isSessionSearchOpen,
    setIsSessionSearchOpen,
    sessionSearchInputRef,
    sessionSearchContainerRef,
  });

  const gitBranches = useGitAllBranches();

  const sync = useSync();
  const liveSessions = useAllServersLiveSessions();
  const liveSessionStatuses = useAllServersSessionStatuses();
  const hasLoadedGlobalSessions = useGlobalSessionsStore((state) => state.hasLoaded);
  const globalActiveSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const archivedSessions = useGlobalSessionsStore((state) => state.archivedSessions);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open));
  const tempDraftSubmitting = useSessionUIStore((state) => Boolean(state.newSessionDraft?.open && state.newSessionDraft?.preserveDirectoryOverride === false && state.newSessionDraft?.submitting));
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const updateSessionTitle = useSessionUIStore((state) => state.updateSessionTitle);
  const shareSession = useSessionUIStore((state) => state.shareSession);
  const unshareSession = useSessionUIStore((state) => state.unshareSession);
  // sessionAttentionStates removed — now using notification-store directly in SessionNodeItem
  const worktreeMetadata = useSessionUIStore((state) => state.worktreeMetadata);
  const availableWorktreesByProject = useSessionUIStore((state) => state.availableWorktreesByProject);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const updateStore = useUpdateStore(useShallow((s) => ({
    checkForUpdates: s.checkForUpdates,
    available: s.available,
    runtimeType: s.runtimeType,
    info: s.info,
    downloading: s.downloading,
    downloaded: s.downloaded,
    progress: s.progress,
    error: s.error,
    downloadUpdate: s.downloadUpdate,
    restartToUpdate: s.restartToUpdate,
  })));

  const knownSessionDirectories = React.useMemo(
    () => buildKnownSessionDirectories(projects, availableWorktreesByProject),
    [availableWorktreesByProject, projects],
  );

  const sessions = React.useMemo(() => {
    const liveById = new Map(liveSessions.map((session) => [session.id, session]));
    const merged = globalActiveSessions.map((session) => liveById.get(session.id) ?? session);
    const seenIds = new Set(merged.map((session) => session.id));

    liveSessions.forEach((session) => {
      if (seenIds.has(session.id)) {
        return;
      }
      merged.push(session);
    });

    return merged.filter((session) => isKnownActiveSessionDirectory(session, knownSessionDirectories));
  }, [globalActiveSessions, knownSessionDirectories, liveSessions]);

  const tempSessionsWithSession = React.useMemo<TempSessionEntry[]>(() => {
    const sessionsByDirectory = new Map<string, Session>();
    const merged = [...globalActiveSessions, ...liveSessions];

    for (const session of merged) {
      const directory = resolveGlobalSessionDirectory(session);
      if (!directory || !directory.includes('/temp-sessions/')) {
        continue;
      }

      const existing = sessionsByDirectory.get(directory);
      const existingTime = existing?.time?.updated ?? existing?.time?.created ?? 0;
      const nextTime = session.time?.updated ?? session.time?.created ?? 0;
      if (!existing || nextTime >= existingTime) {
        sessionsByDirectory.set(directory, session);
      }
    }

    return tempSessions.map((entry) => {
      const normalizedPath = normalizePath(entry.path);
      if (!normalizedPath) {
        return entry;
      }
      const session = sessionsByDirectory.get(normalizedPath);
      return session
        ? { ...entry, sessionId: session.id, sessionDirectory: normalizedPath }
        : entry;
    });
  }, [globalActiveSessions, liveSessions, tempSessions]);

  const syncSessionStructureSignature = React.useMemo(
    () => liveSessions
      .map((session) => {
        const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null) ?? '';
        return `${session.id}:${session.title ?? ''}:${session.time?.archived ? 1 : 0}:${directory}`;
      })
      .join('|'),
    [liveSessions],
  );

  const syncSessionsSnapshotRef = React.useRef<Session[]>(liveSessions);
  React.useEffect(() => {
    syncSessionsSnapshotRef.current = liveSessions;
  }, [syncSessionStructureSignature, liveSessions]);

  React.useEffect(() => {
    let cancelled = false;

    const discoverWorktrees = async () => {
      const projectEntries = useProjectsStore.getState().projects;
      if (projectEntries.length === 0) return;

      const worktreesByProject = new Map<string, WorktreeMetadata[]>();
      const allWorktrees: WorktreeMetadata[] = [];

      await Promise.all(
        projectEntries.map(async (project) => {
          const projectPath = normalizePath(project.path);
          if (!projectPath) return;
          try {
            // Use store-cached isGitRepo when available; fall back to direct check for initial worktree discovery
            const cachedIsGitRepo = useGitStore.getState().directories.get(projectPath)?.isGitRepo;
            const isGitRepo = cachedIsGitRepo ?? await import('@/lib/gitApi').then(m => m.checkIsGitRepository(projectPath));
            if (!isGitRepo) return;
            const worktrees = await listProjectWorktrees({ id: project.id, path: projectPath });
            if (cancelled || worktrees.length === 0) return;
            worktreesByProject.set(projectPath, worktrees);
            allWorktrees.push(...worktrees);
          } catch {
            // ignore discovery errors
          }
        }),
      );

      if (cancelled) return;

      useSessionUIStore.setState({
        availableWorktrees: allWorktrees,
        availableWorktreesByProject: worktreesByProject,
      });
    };

    void refreshGlobalSessions(syncSessionsSnapshotRef.current);
    void discoverWorktrees();

    return () => {
      cancelled = true;
    };
  }, [currentDirectory, syncSessionStructureSignature, projects]);

  React.useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeOpenchamberEvents((event) => {
      if (event.type !== 'scheduled-task-ran') {
        return;
      }
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        void refreshGlobalSessions(syncSessionsSnapshotRef.current);
      }, 500);
    });
    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      unsubscribe();
    };
  }, []);

  const isDesktopShellRuntime = React.useMemo(() => isDesktopShell(), []);
  const isTabletStandalonePwa = useTabletStandalonePwaRuntime();
  const [isDesktopWindowFullscreen, setIsDesktopWindowFullscreen] = React.useState(false);

  React.useEffect(() => {
    const loadTempSessions = async () => {
      try {
        const sessions = await listTempSessions();
        setTempSessions(sessions);
      } catch {
        void 0;
      }
    };

    void loadTempSessions();

    const interval = setInterval(() => {
      void loadTempSessions();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);
  const { isTablet } = useDeviceInfo();
  const alwaysShowSidebarActions = mobileVariant || isTablet;
  const isMacPlatform = React.useMemo(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return /Macintosh|Mac OS X/.test(navigator.userAgent || '');
  }, []);
  const isWebRuntime = !mobileVariant && !isVSCode && !isDesktopShellRuntime;
  const showDesktopSidebarChrome = !mobileVariant && !isVSCode && !isWebRuntime;
  const desktopSidebarTopPaddingClass = (isDesktopShellRuntime && isMacPlatform && !isDesktopWindowFullscreen) || isTabletStandalonePwa ? 'pl-[5.5rem]' : 'pl-3';
  const desktopSidebarToggleButtonClass = 'app-region-no-drag inline-flex h-8 w-8 items-center justify-center rounded-md typography-ui-label font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50';

  React.useEffect(() => {
    if (!isDesktopShellRuntime || !isMacPlatform) {
      setIsDesktopWindowFullscreen(false);
      return;
    }

    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    const syncFullscreenState = async () => {
      try {
        const fullscreen = await getDesktopWindowFullscreen();
        if (!disposed) {
          setIsDesktopWindowFullscreen(fullscreen);
        }
      } catch {
        if (!disposed) {
          setIsDesktopWindowFullscreen(false);
        }
      }
    };

    const attach = async () => {
      try {
        unlistenResize = onDesktopWindowResized(() => {
          void syncFullscreenState();
        });
      } catch {
        // Ignore listener setup failures; fallback state remains false.
      }
    };

    void syncFullscreenState();
    void attach();

    return () => {
      disposed = true;
      if (unlistenResize) {
        unlistenResize();
      }
    };
  }, [isDesktopShellRuntime, isMacPlatform]);

  const handleDesktopSidebarDragStart = React.useCallback(async (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.app-region-no-drag')) {
      return;
    }
    if (target.closest('button, a, input, select, textarea')) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (!isDesktopShellRuntime) {
      return;
    }

    await startDesktopWindowDrag();
  }, [isDesktopShellRuntime]);

  // Global pins only - project-scoped pins are resolved in useSessionGrouping per project section.
  const effectivePinnedSessionIds = pinnedSessionIds;

  const {
    buildGroupSearchText,
    filterSessionNodesForSearch,
    buildGroupedSessions,
  } = useSessionGrouping({
    homeDirectory,
    worktreeMetadata,
    globalPinnedSessionIds: pinnedSessionIds,
    pinnedSessionIdsByProject,
    pinnedOrderByProject,
    sessionSortMode,
    gitBranches,
    isVSCode,
  });

  const { scheduleCollapsedProjectsPersist } = useSidebarPersistence({
    isVSCode,
    hasLoadedGlobalSessions,
    safeStorage,
    keys: {
      sessionExpanded: SESSION_EXPANDED_STORAGE_KEY,
      projectCollapse: PROJECT_COLLAPSE_STORAGE_KEY,
      sessionPinned: SESSION_PINNED_STORAGE_KEY,
      groupOrder: GROUP_ORDER_STORAGE_KEY,
      projectActiveSession: PROJECT_ACTIVE_SESSION_STORAGE_KEY,
      groupCollapse: GROUP_COLLAPSE_STORAGE_KEY,
    },
    sessions,
    pinnedSessionIds,
    setPinnedSessionIds,
    groupOrderByProject,
    activeSessionByProject,
    collapsedGroups,
    setExpandedParents,
    setCollapsedProjects,
  });

  // [2026-05-04] Persist per-project pins to safeStorage
  React.useEffect(() => {
    try {
      const obj: Record<string, string[]> = {};
      pinnedSessionIdsByProject.forEach((ids, key) => {
        obj[key] = Array.from(ids);
      });
      getSafeStorage().setItem(SESSION_PINNED_PER_PROJECT_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignored
    }
  }, [pinnedSessionIdsByProject]);

  React.useEffect(() => {
    try {
      getSafeStorage().setItem(SESSION_PINNED_ORDER_STORAGE_KEY, JSON.stringify(pinnedOrder));
    } catch {
      // ignored
    }
  }, [pinnedOrder]);

  React.useEffect(() => {
    setPinnedOrder((prev) => {
      const filtered = prev.filter((id) => pinnedSessionIds.has(id));
      const existingSet = new Set(filtered);
      let changed = filtered.length !== prev.length;
      for (const id of pinnedSessionIds) {
        if (!existingSet.has(id)) {
          filtered.push(id);
          changed = true;
        }
      }
      return changed ? filtered : prev;
    });
  }, [pinnedSessionIds]);

  React.useEffect(() => {
    try {
      const obj: Record<string, string[]> = {};
      pinnedOrderByProject.forEach((order, key) => {
        obj[key] = order;
      });
      getSafeStorage().setItem(SESSION_PINNED_ORDER_BY_PROJECT_STORAGE_KEY, JSON.stringify(obj));
    } catch {
      // ignored
    }
  }, [pinnedOrderByProject]);

  React.useEffect(() => {
    setPinnedOrderByProject((prev) => {
      let changed = false;
      const next = new Map<string, string[]>();

      pinnedSessionIdsByProject.forEach((ids, projectPath) => {
        const currentOrder = prev.get(projectPath) ?? [];
        const filtered = currentOrder.filter((id) => ids.has(id));
        const existingSet = new Set(filtered);
        let orderChanged = filtered.length !== currentOrder.length;
        for (const id of ids) {
          if (!existingSet.has(id)) {
            filtered.push(id);
            orderChanged = true;
          }
        }
        next.set(projectPath, filtered);
        if (orderChanged) changed = true;
      });

      prev.forEach((order, projectPath) => {
        if (!next.has(projectPath)) {
          next.set(projectPath, order);
        }
      });

      return changed ? next : prev;
    });
  }, [pinnedSessionIdsByProject]);

  const togglePinnedSession = React.useCallback((sessionId: string, scope: 'global' | string) => {
    if (scope === 'global') {
      if (pinnedSessionIdsByProject.size > 0) {
        setPinnedSessionIdsByProject((prev) => {
          const next = new Map(prev);
          let changed = false;
          for (const [project, ids] of prev) {
            if (ids.has(sessionId)) {
              const updated = new Set(ids);
              updated.delete(sessionId);
              changed = true;
              if (updated.size === 0) {
                next.delete(project);
              } else {
                next.set(project, updated);
              }
            }
          }
          return changed ? next : prev;
        });
      }
      setPinnedSessionIds((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
        }
        return next;
      });
    } else {
      if (pinnedSessionIds.has(sessionId)) {
        setPinnedSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
      }
      setPinnedSessionIdsByProject((prev) => {
        const next = new Map(prev);
        const existing = next.get(scope) ?? new Set<string>();
        const updated = new Set(existing);
        if (updated.has(sessionId)) {
          updated.delete(sessionId);
        } else {
          updated.add(sessionId);
        }
        if (updated.size === 0) {
          next.delete(scope);
        } else {
          next.set(scope, updated);
        }
        return next;
      });
    }
  }, [pinnedSessionIds, pinnedSessionIdsByProject]);

  const reorderGlobalPinned = React.useCallback((fromIndex: number, toIndex: number) => {
    setPinnedOrder((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  }, []);

  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => compareSessions(a, b, effectivePinnedSessionIds, sessionSortMode, pinnedOrder));
  }, [sessions, effectivePinnedSessionIds, sessionSortMode, pinnedOrder]);

  const sessionOrderIndex = React.useMemo(
    () => new Map(sortedSessions.map((session, index) => [session.id, index])),
    [sortedSessions],
  );

  const childrenMap = React.useMemo(() => {
    const map = new Map<string, Session[]>();
    sortedSessions.forEach((session) => {
      const parentID = (session as Session & { parentID?: string | null }).parentID;
      if (!parentID) {
        return;
      }
      const collection = map.get(parentID) ?? [];
      collection.push(session);
      map.set(parentID, collection);
    });
    map.forEach((list) => list.sort((a, b) => compareSessions(a, b, effectivePinnedSessionIds, sessionSortMode)));
    return map;
  }, [sortedSessions, effectivePinnedSessionIds, sessionSortMode]);

  const emptyState = (
    <div className="py-6 text-center text-muted-foreground">
      <p className="typography-ui-label font-semibold">{t('sessions.sidebar.empty.noSessions.title')}</p>
      <p className="typography-meta mt-1">{t('sessions.sidebar.empty.noSessions.description')}</p>
    </div>
  );

  const editingProject = React.useMemo(
    () => projects.find((project) => project.id === editingProjectDialogId) ?? null,
    [projects, editingProjectDialogId],
  );

  const handleSaveProjectEdit = React.useCallback((data: { label: string; icon: string | null; color: string | null; iconBackground: string | null }) => {
    if (!editingProjectDialogId) {
      return;
    }
    updateProjectMeta(editingProjectDialogId, data);
    setEditingProjectDialogId(null);
  }, [editingProjectDialogId, updateProjectMeta]);

  const openNewWorktreeDialog = React.useCallback(() => {
    setNewWorktreeDialogOpen(true);
  }, []);

  const handleOpenUpdateDialog = React.useCallback(() => {
    const current = useUpdateStore.getState();
    if (current.available && current.info) {
      setUpdateDialogOpen(true);
      return;
    }

    void updateStore.checkForUpdates().then(() => {
      const { available, error } = useUpdateStore.getState();
      if (error) {
        toast.error(t('sessions.sidebar.updateCheck.errorTitle'), { description: error });
        return;
      }
      if (!available) {
        toast.success(t('sessions.sidebar.updateCheck.latestVersion'));
        return;
      }
      setUpdateDialogOpen(true);
    });
  }, [t, updateStore]);

  const handleOpenSettings = React.useCallback(() => {
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    setSettingsDialogOpen(true);
  }, [mobileVariant, setSessionSwitcherOpen, setSettingsDialogOpen]);

  const showSidebarUpdateButton =
    updateStore.available &&
    (updateStore.runtimeType === 'desktop' || updateStore.runtimeType === 'web');

  const deleteSession = useSessionUIStore((state) => state.deleteSession);
  const deleteSessions = useSessionUIStore((state) => state.deleteSessions);
  const archiveSession = useSessionUIStore((state) => state.archiveSession);
  const archiveSessions = useSessionUIStore((state) => state.archiveSessions);

  const {
    copiedSessionId,
    handleSessionSelect,
    handleSessionDoubleClick,
    handleSaveEdit,
    handleCancelEdit,
    handleShareSession,
    handleCopyShareUrl,
    handleUnshareSession,
    handleDeleteSession,
    confirmDeleteSession,
  } = useSessionActions({
    activeProjectId,
    currentSessionId,
    mobileVariant,
    allowReselect,
    onSessionSelected,
    isSessionSearchOpen,
    sessionSearchQuery,
    setSessionSearchQuery,
    setIsSessionSearchOpen,
    setActiveMainTab,
    setSessionSwitcherOpen,
    updateSessionTitle,
    shareSession,
    unshareSession,
    deleteSession,
    deleteSessions,
    archiveSession,
    archiveSessions,
    childrenMap,
    showDeletionDialog,
    setDeleteSessionConfirm,
    deleteSessionConfirm,
    setEditingId,
    setEditTitle,
    editingId,
    editTitle,
  });

  const confirmDeleteFolder = React.useCallback(() => {
    if (!deleteFolderConfirm) return;
    const { scopeKey, folderId } = deleteFolderConfirm;
    setDeleteFolderConfirm(null);
    deleteFolder(scopeKey, folderId);
  }, [deleteFolderConfirm, deleteFolder]);

  const handleOpenDirectoryDialog = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog();
  }, []);

  // Auto-expand parent session when navigating to a subagent (child) session
  React.useEffect(() => {
    if (!currentSessionId) return;
    const current = sessions.find((s) => s.id === currentSessionId);
    const parentID = (current as Session & { parentID?: string | null })?.parentID;
    if (!parentID) return;
    setExpandedParents((prev) => {
      if (prev.has(parentID)) return prev;
      const next = new Set(prev);
      next.add(parentID);
      try {
        safeStorage.setItem(SESSION_EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }
      return next;
    });
  }, [currentSessionId, sessions, safeStorage]);

  const toggleParent = React.useCallback((sessionId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      try {
        safeStorage.setItem(SESSION_EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }
      return next;
    });
  }, [safeStorage]);

  const createFolderAndStartRename = React.useCallback(
    (scopeKey: string, parentId?: string | null) => {
      if (!scopeKey) {
        return null;
      }

      if (parentId && collapsedFolderIds.has(parentId)) {
        toggleFolderCollapse(parentId);
      }

      const newFolder = createFolder(scopeKey, t('sessions.sidebar.folder.newFolderName'), parentId);
      setRenamingFolderId(newFolder.id);
      setRenameFolderDraft(newFolder.name);
      return newFolder;
    },
    [collapsedFolderIds, toggleFolderCollapse, createFolder, t],
  );

  const toggleGroupSessionLimit = React.useCallback((groupId: string) => {
    setExpandedSessionGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const collapseAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects(() => {
      const allIds = new Set(projects.map((p) => p.id));
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(allIds)));
      } catch { /* ignored */ }
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(allIds);
      }
      return allIds;
    });
  }, [projects, isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const expandAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects(() => {
      const empty = new Set<string>();
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify([]));
      } catch { /* ignored */ }
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(empty);
      }
      return empty;
    });
  }, [isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const toggleProject = React.useCallback((projectId: string) => {
    // Ignore intersection events for a short period after toggling
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }

      // Persist collapse state to server settings (web + desktop local/remote).
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(next);
      }
      return next;
    });
  }, [isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const normalizedProjects = React.useMemo(() => {
    return projects
      .map((project) => ({
        ...project,
        normalizedPath: normalizePath(project.path),
      }))
      .filter((project) => Boolean(project.normalizedPath)) as Array<{
        id: string;
        path: string;
        label?: string;
        normalizedPath: string;
        icon?: string;
        color?: string;
        iconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' };
        iconBackground?: string;
        serverId?: string;
        unavailable?: boolean;
      }>;
  }, [projects]);

  const normalizedProjectPaths = React.useMemo(
    () => normalizedProjects.map((project) => project.normalizedPath),
    [normalizedProjects],
  );

  const { github } = useRuntimeAPIs();
  const githubAuthStatus = useGitHubAuthStore((state) => state.status);
  const githubAuthChecked = useGitHubAuthStore((state) => state.hasChecked);
  const gitRepoStatus = useGitRepoStatusMap(normalizedProjectPaths);
  const ensurePrStatusEntry = useGitHubPrStatusStore((state) => state.ensureEntry);
  const setPrStatusParams = useGitHubPrStatusStore((state) => state.setParams);
  const refreshPrStatusTargets = useGitHubPrStatusStore((state) => state.refreshTargets);

  useProjectRepoStatus({
    normalizedProjects,
    gitRepoStatus,
    setProjectRepoStatus,
    setProjectRootBranches,
  });

  const isSessionsLoading = useSessionUIStore((state) => state.isLoading);
  const sessionProjectBindings = useSessionProjectStore((state) => state.bindings);

  React.useEffect(() => {
    if (!hasLoadedGlobalSessions || normalizedProjects.length === 0) {
      return;
    }
    const ownershipProjects = normalizedProjects.map((p) => ({
      id: p.id,
      normalizedPath: p.normalizedPath,
      serverId: p.serverId,
    }));
    hydrateSessionProjectBindings(
      [...sessions, ...archivedSessions],
      ownershipProjects,
      availableWorktreesByProject,
    );
  }, [archivedSessions, availableWorktreesByProject, hasLoadedGlobalSessions, normalizedProjects, sessions]);

  const ownershipProjects = React.useMemo(
    () => normalizedProjects.map((p) => ({
      id: p.id,
      normalizedPath: p.normalizedPath,
      serverId: p.serverId,
    })),
    [normalizedProjects],
  );

  const { getSessionsForProject, getArchivedSessionsForProject } = useProjectSessionLists({
    isVSCode,
    sessions,
    archivedSessions,
    availableWorktreesByProject,
    normalizedProjects: ownershipProjects,
    bindings: sessionProjectBindings,
  });

  useSessionFolderCleanup({
    isSessionsLoading,
    sessions,
    normalizedProjects,
    getArchivedSessionsForProject,
    cleanupSessions,
  });

  useArchivedAutoFolders({
    normalizedProjects,
    isSessionsLoading,
    foldersMap,
    getArchivedSessionsForProject,
    createFolder,
    addSessionToFolder,
    cleanupSessions,
  });

  const {
    projectSections,
    groupSearchDataByGroup,
    sectionsForRender,
    searchMatchCount,
  } = useSessionSidebarSections({
    normalizedProjects,
    getSessionsForProject,
    getArchivedSessionsForProject,
    availableWorktreesByProject,
    projectRepoStatus,
    projectRootBranches,
    buildGroupedSessions,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
    filterSessionNodesForSearch,
    buildGroupSearchText,
    foldersMap,
  });

  const searchEmptyState = (
    <div className="py-6 text-center text-muted-foreground">
      <p className="typography-ui-label font-semibold">{t('sessions.sidebar.empty.noMatches.title')}</p>
      <p className="typography-meta mt-1">{t('sessions.sidebar.empty.noMatches.description')}</p>
    </div>
  );

  const reserveHeaderActionsSpace = true;

  const { currentSessionDirectory } = useProjectSessionSelection({
    projectSections,
    activeProjectId,
    activeSessionByProject,
    setActiveSessionByProject,
    currentSessionId,
    newSessionDraftOpen,
    mobileVariant,
    openNewSessionDraft,
    setActiveMainTab,
    setSessionSwitcherOpen,
    sessions,
    worktreeMetadata,
  });

  const { getOrderedGroups } = useGroupOrdering(groupOrderByProject);
  const hasInitializedArchivedCollapseRef = React.useRef(false);

  React.useEffect(() => {
    if (hasInitializedArchivedCollapseRef.current || projectSections.length === 0) {
      return;
    }
    const archivedGroupKeys = projectSections.flatMap((section) =>
      section.groups
        .filter((group) => group.isArchivedBucket)
        .map((group) => `${section.project.id}:${group.id}`),
    );
    if (archivedGroupKeys.length > 0) {
      setCollapsedGroups((prev) => new Set([...prev, ...archivedGroupKeys]));
    }
    hasInitializedArchivedCollapseRef.current = true;
  }, [projectSections]);

  const sessionSidebarMetaById = React.useMemo(() => {
    const meta = new Map<string, {
      node: SessionNode;
      projectId: string | null;
      groupDirectory: string | null;
      secondaryMeta: {
        projectLabel?: string | null;
        branchLabel?: string | null;
      } | null;
    }>();
    const projectPathLengthBySessionId = new Map<string, number>();

    projectSections.forEach((section) => {
      const projectLabel = formatProjectLabel(
        section.project.label?.trim()
        || formatDirectoryName(section.project.normalizedPath, homeDirectory)
        || section.project.normalizedPath,
      );
      section.groups.forEach((group) => {
        const secondaryMeta = group.branch && group.branch !== projectLabel
          ? { projectLabel, branchLabel: group.branch }
          : { projectLabel, branchLabel: null };

        const visit = (nodes: SessionNode[]) => {
          nodes.forEach((node) => {
            const nextProjectPathLength = section.project.normalizedPath.length;
            const currentProjectPathLength = projectPathLengthBySessionId.get(node.session.id) ?? -1;
            if (nextProjectPathLength < currentProjectPathLength) {
              return;
            }

            meta.set(node.session.id, {
              node,
              projectId: section.project.id,
              groupDirectory: group.directory,
              secondaryMeta,
            });
            projectPathLengthBySessionId.set(node.session.id, nextProjectPathLength);
            if (node.children.length > 0) {
              visit(node.children);
            }
          });
        };

        visit(group.sessions);
      });
    });

    return meta;
  }, [projectSections, homeDirectory]);

  const resolvePinnedSessionMeta = React.useCallback((session: Session) => {
    const sessionDirectory = resolveGlobalSessionDirectory(session);
    if (!sessionDirectory) {
      return null;
    }

    const indexedServerId = serverRegistry.getServerForSession(session.id);
    const candidates = normalizedProjects
      .filter((project) => {
        if (!indexedServerId) return true;
        const projectServerId = project.serverId ?? DEFAULT_SERVER_ID;
        return projectServerId === indexedServerId;
      })
      .filter((project) => directoryBelongsToProject(sessionDirectory, project.normalizedPath))
      .sort((a, b) => b.normalizedPath.length - a.normalizedPath.length);

    const project = candidates[0] ?? null;
    if (!project) {
      return null;
    }

    const projectLabel = formatProjectLabel(
      project.label?.trim()
      || formatDirectoryName(project.normalizedPath, homeDirectory)
      || project.normalizedPath,
    );
    const worktree = (availableWorktreesByProject.get(project.normalizedPath) ?? [])
      .find((meta) => normalizePath(meta.path) === sessionDirectory);
    const branch = gitBranches.get(sessionDirectory)?.trim()
      || worktree?.branch?.trim()
      || (sessionDirectory === project.normalizedPath ? projectRootBranches.get(project.id)?.trim() ?? null : null);
    const secondaryMeta = branch && branch !== projectLabel
      ? { projectLabel, branchLabel: branch }
      : { projectLabel, branchLabel: null };

    return {
      projectId: project.id,
      groupDirectory: sessionDirectory,
      secondaryMeta,
    };
  }, [availableWorktreesByProject, gitBranches, homeDirectory, normalizedProjects, projectRootBranches]);

  const showRecentSection = useSessionDisplayStore((state) => state.showRecentSection);

  const activeNowSessions = React.useMemo(() => {
    if (!showRecentSection) {
      return [];
    }

    return deriveActiveNowSessions(activeNowEntries, new Map(sessions.map((session) => [session.id, session])))
      .sort((a, b) => compareSessions(a, b, effectivePinnedSessionIds, sessionSortMode));
  }, [activeNowEntries, effectivePinnedSessionIds, sessions, sessionSortMode, showRecentSection]);

  const liveActiveSessions = React.useMemo(() => {
    if (!showRecentSection) {
      return [];
    }

    return deriveLiveActiveNowSessions(sessions, liveSessionStatuses);
  }, [liveSessionStatuses, sessions, showRecentSection]);

  React.useEffect(() => {
    if (!showRecentSection || liveActiveSessions.length === 0) {
      return;
    }

    setActiveNowEntries((prev) => {
      const next = liveActiveSessions.reduce((entries, session) => addActiveNowSession(entries, session.id), prev);
      if (next === prev) {
        return prev;
      }
      persistActiveNowEntries(safeStorage, next);
      return next;
    });
  }, [liveActiveSessions, safeStorage, showRecentSection]);

  React.useEffect(() => {
    if (!showRecentSection) {
      return;
    }

    const allKnownSessionsById = new Map<string, Session>();
    [...sessions, ...archivedSessions].forEach((session) => {
      allKnownSessionsById.set(session.id, session);
    });

    const pruned = pruneActiveNowEntries(activeNowEntries, allKnownSessionsById, {
      hasLoadedSessions: hasLoadedGlobalSessions,
    });
    if (pruned.length === activeNowEntries.length && pruned.every((entry, index) => entry.sessionId === activeNowEntries[index]?.sessionId)) {
      return;
    }

    setActiveNowEntries(pruned);
    persistActiveNowEntries(safeStorage, pruned);
  }, [activeNowEntries, archivedSessions, hasLoadedGlobalSessions, safeStorage, sessions, showRecentSection]);

  const globalPinnedSessions = React.useMemo(() => {
    const pinned = sessions.filter((s) => pinnedSessionIds.has(s.id));
    if (pinnedOrder.length === 0) return pinned;
    const orderMap = new Map(pinnedOrder.map((id, index) => [id, index]));
    return pinned.sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? Infinity;
      const bIdx = orderMap.get(b.id) ?? Infinity;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return (a.time?.updated ?? a.time?.created ?? 0) - (b.time?.updated ?? b.time?.created ?? 0);
    });
  }, [sessions, pinnedSessionIds, pinnedOrder]);

  const globalPinnedSection = React.useMemo(() => {
    if (globalPinnedSessions.length === 0) {
      return null;
    }

    const buildNode = (session: Session): SessionNode => {
      const childSessions = childrenMap.get(session.id) ?? [];
      return { session, children: childSessions.map((child) => buildNode(child)), worktree: null };
    };

    const toItem = (session: Session) => {
      const existing = sessionSidebarMetaById.get(session.id);
      const sessionDirectory = resolveGlobalSessionDirectory(session);
      const pinnedMeta = resolvePinnedSessionMeta(session);
      return {
        node: existing?.node ?? buildNode(session),
        projectId: pinnedMeta?.projectId ?? existing?.projectId ?? null,
        groupDirectory: pinnedMeta?.groupDirectory ?? existing?.groupDirectory ?? sessionDirectory,
        secondaryMeta: pinnedMeta?.secondaryMeta ?? existing?.secondaryMeta ?? null,
      };
    };

    return {
      key: 'global-pinned' as const,
      title: t('sessions.sidebar.activity.globalPinnedTitle'),
      items: globalPinnedSessions.map(toItem),
    } satisfies ActivitySection;
  }, [globalPinnedSessions, sessionSidebarMetaById, childrenMap, resolvePinnedSessionMeta, t]);

  // Prefetch is wired below, after recentSessionIds is computed.

  const activitySections = React.useMemo(() => {
    if (!showRecentSection) {
      return [];
    }

    const toItem = (session: Session) => {
      const existing = sessionSidebarMetaById.get(session.id);
      const sessionDirectory = resolveGlobalSessionDirectory(session);
      const node: SessionNode = existing?.node ?? { session, children: [], worktree: null } as unknown as SessionNode;
      return {
        node,
        projectId: existing?.projectId ?? null,
        groupDirectory: existing?.groupDirectory ?? sessionDirectory,
        secondaryMeta: existing?.secondaryMeta ?? null,
      };
    };

    return [
      { key: 'active-now' as const, title: t('sessions.sidebar.activity.recentTitle'), items: activeNowSessions.map(toItem) },
    ];
  }, [activeNowSessions, sessionSidebarMetaById, showRecentSection, t]);

  const recentSessionIds = React.useMemo(() => {
    return new Set(activeNowSessions.map((session) => session.id));
  }, [activeNowSessions]);

  const recentSessionIdsList = React.useMemo(() => [...recentSessionIds], [recentSessionIds]);

  useSessionPrefetch({
    currentSessionId,
    sortedSessions,
    recentSessionIds: recentSessionIdsList,
    ensureSessionRenderable: sync.ensureSessionRenderable,
  });

  const sectionsForSidebarRender = React.useMemo(() => {
    if (!isVSCode || hasSessionSearchQuery || recentSessionIds.size === 0) {
      return sectionsForRender;
    }

    const filterNodes = (nodes: SessionNode[]): SessionNode[] => {
      return nodes.reduce<SessionNode[]>((acc, node) => {
        if (recentSessionIds.has(node.session.id)) {
          return acc;
        }

        const filteredChildren = filterNodes(node.children);
        if (filteredChildren.length === node.children.length) {
          acc.push(node);
          return acc;
        }

        acc.push({
          ...node,
          children: filteredChildren,
        });
        return acc;
      }, []);
    };

    return sectionsForRender.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        sessions: filterNodes(group.sessions),
      })),
    }));
  }, [isVSCode, hasSessionSearchQuery, recentSessionIds, sectionsForRender]);

  const prLookupKeys = React.useMemo(() => {
    const keys = new Set<string>();
    sectionsForSidebarRender.forEach((section) => {
      section.groups.forEach((group) => {
        const directory = normalizePath(group.directory ?? null);
        const branch = group.branch?.trim() || gitBranches.get(directory || '')?.trim();
        if (!directory || !branch) {
          return;
        }
        keys.add(getGitHubPrStatusKey(directory, branch));
      });
    });
    return [...keys];
  }, [gitBranches, sectionsForSidebarRender]);

  const prVisualSummaryMap = usePrVisualSummaryByKeys(prLookupKeys);

  React.useEffect(() => {
    if (!githubAuthChecked || !githubAuthStatus?.connected || !github) {
      return;
    }

    const missingTargets: Array<{ directory: string; branch: string; remoteName?: string | null }> = [];
    const now = Date.now();

    sectionsForSidebarRender.forEach((section) => {
      if (collapsedProjects.has(section.project.id)) {
        return;
      }

      section.groups.forEach((group) => {
        const directory = normalizePath(group.directory ?? null);
        const branch = group.branch?.trim() || gitBranches.get(directory || '')?.trim();
        if (!directory || !branch) {
          return;
        }
        const key = getGitHubPrStatusKey(directory, branch);
        const entry = useGitHubPrStatusStore.getState().entries[key];
        const hasPr = Boolean(entry?.status?.pr);
        const retryKey = `${directory}::${branch}`;
        const noPrLastCheckedAt = Math.max(entry?.lastRefreshAt ?? 0, entry?.lastDiscoveryPollAt ?? 0);
        const shouldRetryNoPr = Boolean(
          entry?.isInitialStatusResolved
          && !hasPr
          && (
            !retriedNoPrStatusKeysRef.current.has(retryKey)
            || now - noPrLastCheckedAt >= SIDEBAR_PR_NO_PR_RETRY_MS
          ),
        );

        if (!entry || !entry.isInitialStatusResolved || shouldRetryNoPr) {
          if (shouldRetryNoPr) {
            retriedNoPrStatusKeysRef.current.add(retryKey);
          }
          missingTargets.push({ directory, branch });
        }
      });
    });

    if (missingTargets.length === 0) {
      return;
    }

    const uniqueTargets = new Map<string, { directory: string; branch: string; remoteName?: string | null }>();
    missingTargets.forEach((target) => {
      const key = getGitHubPrStatusKey(target.directory, target.branch, target.remoteName ?? null);
      if (!uniqueTargets.has(key)) {
        uniqueTargets.set(key, target);
      }
    });

    uniqueTargets.forEach((target, key) => {
      ensurePrStatusEntry(key);
      setPrStatusParams(key, {
        directory: target.directory,
        branch: target.branch,
        remoteName: target.remoteName ?? null,
        canShow: true,
        github,
        githubAuthChecked,
        githubConnected: githubAuthStatus.connected,
      });
    });

    void refreshPrStatusTargets([...uniqueTargets.values()], {
      force: true,
      silent: true,
      markInitialResolved: true,
    });
  }, [
    collapsedProjects,
    ensurePrStatusEntry,
    github,
    githubAuthChecked,
    githubAuthStatus?.connected,
    gitBranches,
    refreshPrStatusTargets,
    sectionsForSidebarRender,
    setPrStatusParams,
  ]);

  const desktopHeaderActionButtonClass =
    'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-muted-foreground hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed';
  const mobileHeaderActionButtonClass =
    'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed';
  const headerActionButtonClass = mobileVariant ? mobileHeaderActionButtonClass : desktopHeaderActionButtonClass;
  const headerActionIconClass = 'h-4 w-4';
  const stuckProjectHeaders = useStickyProjectHeaders({
    isDesktopShellRuntime,
    projectSections,
    projectHeaderSentinelRefs,
  });

  const renderSessionNode = React.useCallback(
    (
      node: SessionNode,
      depth = 0,
      groupDirectory?: string | null,
      projectId?: string | null,
      archivedBucket = false,
      secondaryMeta?: { projectLabel?: string | null; branchLabel?: string | null } | null,
      renderContext: 'project' | 'recent' | 'global-pinned' = 'project',
    ): React.ReactNode => (
      <SessionNodeItem
        node={node}
        depth={depth}
        groupDirectory={groupDirectory}
        projectId={projectId}
        archivedBucket={archivedBucket}
        directoryStatus={directoryStatus}
        currentSessionId={currentSessionId}
        pinnedSessionIds={pinnedSessionIds}
        pinnedSessionIdsByProject={pinnedSessionIdsByProject}
        expandedParents={expandedParents}
        hasSessionSearchQuery={hasSessionSearchQuery}
        normalizedSessionSearchQuery={normalizedSessionSearchQuery}
        notifyOnSubtasks={notifyOnSubtasks}
        editingId={editingId}
        setEditingId={setEditingId}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        handleSaveEdit={handleSaveEdit}
        handleCancelEdit={handleCancelEdit}
        toggleParent={toggleParent}
        handleSessionSelect={handleSessionSelect}
        handleSessionDoubleClick={handleSessionDoubleClick}
        togglePinnedSession={togglePinnedSession}
        handleShareSession={handleShareSession}
        copiedSessionId={copiedSessionId}
        handleCopyShareUrl={handleCopyShareUrl}
        handleUnshareSession={handleUnshareSession}
        openSidebarMenuKey={openSidebarMenuKey}
        setOpenSidebarMenuKey={setOpenSidebarMenuKey}
        renamingFolderId={renamingFolderId}
        getFoldersForScope={getFoldersForScope}
        getSessionFolderId={getSessionFolderId}
        removeSessionFromFolder={removeSessionFromFolder}
        addSessionToFolder={addSessionToFolder}
        createFolderAndStartRename={createFolderAndStartRename}
        openContextPanelTab={openContextPanelTab}
        handleDeleteSession={handleDeleteSession}
        onRegenerateTitle={(sessionId, sessionTitle) => setRegenerateTitleSession({ id: sessionId, title: sessionTitle })}
        mobileVariant={mobileVariant}
        alwaysShowActions={alwaysShowSidebarActions}
        renderSessionNode={renderSessionNode}
        secondaryMeta={secondaryMeta}
        renderContext={renderContext}
      />
    ),
    [
      directoryStatus,
      currentSessionId,
      pinnedSessionIds,
      pinnedSessionIdsByProject,
      expandedParents,
      hasSessionSearchQuery,
      normalizedSessionSearchQuery,
      notifyOnSubtasks,
      editingId,
      setEditingId,
      editTitle,
      setEditTitle,
      handleSaveEdit,
      handleCancelEdit,
      toggleParent,
      handleSessionSelect,
      handleSessionDoubleClick,
      togglePinnedSession,
      handleShareSession,
      copiedSessionId,
      handleCopyShareUrl,
      handleUnshareSession,
      openSidebarMenuKey,
      setOpenSidebarMenuKey,
      renamingFolderId,
      getFoldersForScope,
      getSessionFolderId,
      removeSessionFromFolder,
      addSessionToFolder,
      createFolderAndStartRename,
      openContextPanelTab,
      handleDeleteSession,
      setRegenerateTitleSession,
      mobileVariant,
      alwaysShowSidebarActions,
    ],
  );

  const toggleCollapsedGroup = React.useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const prVisualStateByDirectoryBranch = React.useMemo(() => {
    const result = new Map<string, PrIndicator>();
    for (const [key, summary] of prVisualSummaryMap) {
      result.set(key, {
        visualState: summary.visualState as PrVisualState,
        number: summary.number,
        url: summary.url,
        state: summary.prState as 'open' | 'closed' | 'merged',
        draft: summary.draft,
        title: summary.title,
        base: summary.base,
        head: summary.head,
        checks: summary.checks as PrIndicator['checks'],
        canMerge: summary.canMerge,
        mergeableState: summary.mergeableState,
        repo: summary.repo,
      });
    }
    return result;
  }, [prVisualSummaryMap]);

  const renderGroupSessions = React.useCallback(
    (group: SessionGroup, groupKey: string, projectId?: string | null, hideGroupLabel?: boolean, dragHandleProps?: SortableDragHandleProps | null, compactBodyPadding?: boolean) => (
      <SessionGroupSection
        group={group}
        groupKey={groupKey}
        projectId={projectId}
        hideGroupLabel={hideGroupLabel}
        compactBodyPadding={compactBodyPadding}
        hasSessionSearchQuery={hasSessionSearchQuery}
        normalizedSessionSearchQuery={normalizedSessionSearchQuery}
        groupSearchDataByGroup={groupSearchDataByGroup}
        expandedSessionGroups={expandedSessionGroups}
        collapsedGroups={collapsedGroups}
        hideDirectoryControls={hideDirectoryControls}
        collapsedFolderIds={collapsedFolderIds}
        toggleFolderCollapse={toggleFolderCollapse}
        renameFolder={renameFolder}
        deleteFolder={deleteFolder}
        showDeletionDialog={showDeletionDialog}
        setDeleteFolderConfirm={setDeleteFolderConfirm}
        renderSessionNode={renderSessionNode}
        currentSessionDirectory={currentSessionDirectory}
        projectRepoStatus={projectRepoStatus}
        toggleGroupSessionLimit={toggleGroupSessionLimit}
        mobileVariant={mobileVariant}
        alwaysShowActions={alwaysShowSidebarActions}
        activeProjectId={activeProjectId}
        setActiveProjectIdOnly={setActiveProjectIdOnly}
        setActiveMainTab={setActiveMainTab}
        setSessionSwitcherOpen={setSessionSwitcherOpen}
        openNewSessionDraft={openNewSessionDraft}
        addSessionToFolder={addSessionToFolder}
        createFolderAndStartRename={createFolderAndStartRename}
        renamingFolderId={renamingFolderId}
        renameFolderDraft={renameFolderDraft}
        setRenameFolderDraft={setRenameFolderDraft}
        setRenamingFolderId={setRenamingFolderId}
        pinnedSessionIds={pinnedSessionIds}
        projectPinnedSessionIds={group.directory ? (pinnedSessionIdsByProject.get(normalizePath(group.directory) ?? '') ?? new Set()) : new Set()}
        sessionOrderIndex={sessionOrderIndex}
        prVisualStateByDirectoryBranch={prVisualStateByDirectoryBranch}
        onToggleCollapsedGroup={toggleCollapsedGroup}
        dragHandleProps={dragHandleProps}
      />
    ),
    [
      hasSessionSearchQuery,
      normalizedSessionSearchQuery,
      groupSearchDataByGroup,
      expandedSessionGroups,
      collapsedGroups,
      hideDirectoryControls,
      collapsedFolderIds,
      toggleFolderCollapse,
      renameFolder,
      deleteFolder,
      showDeletionDialog,
      renderSessionNode,
      currentSessionDirectory,
      projectRepoStatus,
      toggleGroupSessionLimit,
      mobileVariant,
      alwaysShowSidebarActions,
      activeProjectId,
      setActiveProjectIdOnly,
      setActiveMainTab,
      setSessionSwitcherOpen,
      openNewSessionDraft,
      addSessionToFolder,
      createFolderAndStartRename,
      renamingFolderId,
      renameFolderDraft,
      pinnedSessionIds,
      pinnedSessionIdsByProject,
      sessionOrderIndex,
      prVisualStateByDirectoryBranch,
      toggleCollapsedGroup,
    ],
  );

  const topContent = hasSessionSearchQuery ? null : (
    <>
      {globalPinnedSection ? (
        <SidebarActivitySections
          sections={[globalPinnedSection]}
          renderSessionNode={renderSessionNode}
          onReorderGlobalPinned={reorderGlobalPinned}
        />
      ) : null}
      {showRecentSection ? (
        <SidebarActivitySections
          sections={activitySections}
          renderSessionNode={renderSessionNode}
        />
      ) : null}
    </>
  );
  const isInlineEditing = Boolean(renamingFolderId || editingId || editingProjectDialogId);

  const selectionModeEnabled = useSessionMultiSelectStore((state) => state.enabled);
  const selectedIds = useSessionMultiSelectStore((state) => state.selectedIds);
  const selectionScopeKey = useSessionMultiSelectStore((state) => state.scopeKey);
  const multiSelectStoreApi = useSessionMultiSelectStore;

  const handleToggleSelectionMode = React.useCallback(() => {
    useSessionMultiSelectStore.getState().toggleMode();
  }, []);
  const handleExitSelectionMode = React.useCallback(() => {
    useSessionMultiSelectStore.getState().disable();
  }, []);

  const bulkScopeIsArchived = React.useMemo(() => {
    if (selectedIds.size === 0) return false;
    if (typeof document === 'undefined') return false;
    let sawActive = false;
    let sawArchived = false;
    for (const id of selectedIds) {
      const rows = document.querySelectorAll<HTMLElement>(`[data-session-row="${CSS.escape(id)}"]`);
      for (const row of rows) {
        if (row.getAttribute('data-session-archived') === '1') sawArchived = true;
        else sawActive = true;
      }
    }
    return sawArchived && !sawActive;
  }, [selectedIds]);

  const derivedSelectionScope = React.useMemo(() => {
    if (selectionScopeKey) return selectionScopeKey;
    if (selectedIds.size === 0) return null;
    if (typeof document === 'undefined') return null;
    for (const id of selectedIds) {
      const row = document.querySelector<HTMLElement>(`[data-session-row="${CSS.escape(id)}"]`);
      const scope = row?.getAttribute('data-session-scope');
      if (scope && scope.length > 0) return scope;
    }
    return null;
  }, [selectedIds, selectionScopeKey]);

  const bulkScopeFolders = React.useMemo(() => {
    if (!derivedSelectionScope) return [];
    return foldersMap[derivedSelectionScope] ?? [];
  }, [foldersMap, derivedSelectionScope]);

  const bulkCanRemoveFromFolder = React.useMemo(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return false;
    const scopeFolders = foldersMap[derivedSelectionScope] ?? [];
    for (const folder of scopeFolders) {
      for (const id of folder.sessionIds) {
        if (selectedIds.has(id)) return true;
      }
    }
    return false;
  }, [foldersMap, derivedSelectionScope, selectedIds]);

  const handleBulkMoveToFolder = React.useCallback((folderId: string) => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    addSessionsToFolder(derivedSelectionScope, folderId, Array.from(selectedIds));
  }, [addSessionsToFolder, selectedIds, derivedSelectionScope]);

  const handleBulkCreateFolderAndMove = React.useCallback(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    const newFolder = createFolderAndStartRename(derivedSelectionScope);
    if (!newFolder) return;
    addSessionsToFolder(derivedSelectionScope, newFolder.id, Array.from(selectedIds));
  }, [addSessionsToFolder, createFolderAndStartRename, selectedIds, derivedSelectionScope]);

  const handleBulkRemoveFromFolder = React.useCallback(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    removeSessionsFromFolders(derivedSelectionScope, Array.from(selectedIds));
  }, [removeSessionsFromFolders, selectedIds, derivedSelectionScope]);

  const executeBulkDelete = React.useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (bulkScopeIsArchived) {
      const { deletedIds, failedIds } = await deleteSessions(ids);
      if (deletedIds.length > 0) {
        toast.success(deletedIds.length === 1
          ? t('sessions.sidebar.bulkActions.deletedSingle', { count: deletedIds.length })
          : t('sessions.sidebar.bulkActions.deletedPlural', { count: deletedIds.length }));
      }
      if (failedIds.length > 0) {
        toast.error(failedIds.length === 1
          ? t('sessions.sidebar.bulkActions.failedDeleteSingle', { count: failedIds.length })
          : t('sessions.sidebar.bulkActions.failedDeletePlural', { count: failedIds.length }));
      }
    } else {
      const { archivedIds, failedIds } = await archiveSessions(ids);
      if (archivedIds.length > 0) {
        toast.success(archivedIds.length === 1
          ? t('sessions.sidebar.bulkActions.archivedSingle', { count: archivedIds.length })
          : t('sessions.sidebar.bulkActions.archivedPlural', { count: archivedIds.length }));
      }
      if (failedIds.length > 0) {
        toast.error(failedIds.length === 1
          ? t('sessions.sidebar.bulkActions.failedArchiveSingle', { count: failedIds.length })
          : t('sessions.sidebar.bulkActions.failedArchivePlural', { count: failedIds.length }));
      }
    }
    useSessionMultiSelectStore.getState().clear();
  }, [archiveSessions, bulkScopeIsArchived, deleteSessions, selectedIds, t]);

  const handleBulkDelete = React.useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!showDeletionDialog) {
      void executeBulkDelete();
      return;
    }
    setBulkDeleteConfirm({ sessionCount: count, archivedBucket: bulkScopeIsArchived });
  }, [bulkScopeIsArchived, executeBulkDelete, selectedIds, showDeletionDialog]);

  const confirmBulkDelete = React.useCallback(async () => {
    setBulkDeleteConfirm(null);
    await executeBulkDelete();
  }, [executeBulkDelete]);

  React.useEffect(() => {
    if (!selectionModeEnabled) return;
    const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent || '');
    const listener = (event: KeyboardEvent) => {
      if (isInlineEditing) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        useSessionMultiSelectStore.getState().disable();
        return;
      }
      if (modifier && event.key === 'Backspace') {
        event.preventDefault();
        handleBulkDelete();
        return;
      }
      if (modifier && (event.key === 'a' || event.key === 'A')) {
        const rows = typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-session-row]'))
          : [];
        if (rows.length === 0) return;
        event.preventDefault();
        const currentScope = multiSelectStoreApi.getState().scopeKey;
        const targetScope = currentScope
          ?? rows[0]?.getAttribute('data-session-scope')
          ?? null;
        const scopeFilter = (el: HTMLElement): boolean => {
          if (!targetScope) return true;
          return el.getAttribute('data-session-scope') === targetScope;
        };
        const ids = rows
          .filter(scopeFilter)
          .map((el) => el.getAttribute('data-session-row'))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (ids.length === 0) return;
        multiSelectStoreApi.getState().replaceAll(ids, targetScope || null);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleBulkDelete, isInlineEditing, multiSelectStoreApi, selectionModeEnabled]);
  const handleSidebarNewSession = React.useCallback(() => {
    setActiveMainTab('chat');
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    openNewSessionDraft();
  }, [mobileVariant, openNewSessionDraft, setActiveMainTab, setSessionSwitcherOpen]);

  const handleOpenMultiRunFromHeader = React.useCallback(() => {
    setActiveMainTab('chat');
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    openMultiRunLauncher();
  }, [mobileVariant, openMultiRunLauncher, setActiveMainTab, setSessionSwitcherOpen]);

  const handleNewTempSession = React.useCallback(() => {
    setActiveMainTab('chat');
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }

    openNewSessionDraft({ 
      directoryOverride: null,
      preserveDirectoryOverride: false,
    });
  }, [mobileVariant, openNewSessionDraft, setActiveMainTab, setSessionSwitcherOpen]);

  return (
    <div
      ref={sessionSearchContainerRef}
      className={cn(
        'relative flex h-full flex-col text-foreground overflow-x-hidden',
        mobileVariant ? '' : 'bg-transparent',
      )}
    >
      {showDesktopSidebarChrome ? (
        <div
          onMouseDown={handleDesktopSidebarDragStart}
          className={cn(
            'app-region-drag flex h-[var(--oc-header-height,56px)] flex-shrink-0 items-center pr-3',
            desktopSidebarTopPaddingClass,
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleSidebar}
                className={desktopSidebarToggleButtonClass}
                aria-label={t('sessions.sidebar.header.actions.closeSessions')}
              >
                <RiLayoutLeftLine className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('sessions.sidebar.header.actions.closeSessions')}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}

      <SidebarHeader
        hideDirectoryControls={hideDirectoryControls}
        handleOpenDirectoryDialog={handleOpenDirectoryDialog}
        handleNewSession={handleSidebarNewSession}
        handleNewTempSession={handleNewTempSession}
        canOpenMultiRun={multiRunEnabled && projects.length > 0}
        openMultiRunLauncher={handleOpenMultiRunFromHeader}
        headerActionIconClass={headerActionIconClass}
        reserveHeaderActionsSpace={reserveHeaderActionsSpace}
        headerActionButtonClass={headerActionButtonClass}
        isSessionSearchOpen={isSessionSearchOpen}
        setIsSessionSearchOpen={setIsSessionSearchOpen}
        sessionSearchInputRef={sessionSearchInputRef}
        sessionSearchQuery={sessionSearchQuery}
        setSessionSearchQuery={setSessionSearchQuery}
        hasSessionSearchQuery={hasSessionSearchQuery}
        searchMatchCount={searchMatchCount}
        collapseAllProjects={collapseAllProjects}
        expandAllProjects={expandAllProjects}
        openScheduledTasksDialog={() => setScheduledTasksDialogOpen(true)}
        selectionModeEnabled={selectionModeEnabled}
        onToggleSelectionMode={handleToggleSelectionMode}
        showSidebarToggle={isWebRuntime}
        onToggleSidebar={toggleSidebar}
        avoidWindowControlsOverlay={isTabletStandalonePwa}
        onRefresh={() => { void refreshGlobalSessions(syncSessionsSnapshotRef.current); }}
      />

      <SidebarProjectsList
        topContent={topContent}
        sectionsForRender={sectionsForSidebarRender}
        projectSections={projectSections}
        activeProjectId={activeProjectId}
        showOnlyMainWorkspace={showOnlyMainWorkspace}
        hasSessionSearchQuery={hasSessionSearchQuery}
        emptyState={emptyState}
        searchEmptyState={searchEmptyState}
        renderGroupSessions={renderGroupSessions}
        homeDirectory={homeDirectory}
        collapsedProjects={collapsedProjects}
        hideDirectoryControls={hideDirectoryControls}
        projectRepoStatus={projectRepoStatus}
        isDesktopShellRuntime={isDesktopShellRuntime}
        stuckProjectHeaders={stuckProjectHeaders}
        mobileVariant={mobileVariant}
        alwaysShowActions={alwaysShowSidebarActions}
        toggleProject={toggleProject}
        setActiveProjectIdOnly={setActiveProjectIdOnly}
        setActiveMainTab={setActiveMainTab}
        setSessionSwitcherOpen={setSessionSwitcherOpen}
        openNewSessionDraft={openNewSessionDraft}
        openNewWorktreeDialog={openNewWorktreeDialog}
        openProjectEditDialog={setEditingProjectDialogId}
        removeProject={removeProject}
        projectHeaderSentinelRefs={projectHeaderSentinelRefs}
        reorderProjects={reorderProjects}
        toggleProjectPin={toggleProjectPin}
        getOrderedGroups={getOrderedGroups}
        setGroupOrderByProject={setGroupOrderByProject}
        openSidebarMenuKey={openSidebarMenuKey}
        setOpenSidebarMenuKey={setOpenSidebarMenuKey}
        onRefreshProject={() => { void refreshGlobalSessions(syncSessionsSnapshotRef.current); }}
        isInlineEditing={isInlineEditing}
      />

      {selectionModeEnabled && selectedIds.size > 0 ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          scopeKey={derivedSelectionScope}
          scopeFolders={bulkScopeFolders}
          archivedBucket={bulkScopeIsArchived}
          onMoveToFolder={handleBulkMoveToFolder}
          onCreateFolderAndMove={handleBulkCreateFolderAndMove}
          onRemoveFromFolder={handleBulkRemoveFromFolder}
          canRemoveFromFolder={bulkCanRemoveFromFolder}
          onDelete={handleBulkDelete}
          onDone={handleExitSelectionMode}
        />
      ) : null}

      {!hasSessionSearchQuery && (
        <TempSessionsSection
          tempSessions={tempSessionsWithSession}
          currentSessionDirectory={currentDirectory}
          onSelectTempSession={(session) => {
            setActiveMainTab('chat');
            if (!session.sessionId) {
              toast.error(t('sessions.sidebar.tempSession.unavailable'));
              return;
            }
            setCurrentSession(session.sessionId, session.sessionDirectory ?? session.path);
            if (mobileVariant) {
              setSessionSwitcherOpen(false);
            }
          }}
          onArchiveTempSession={async (path) => {
            try {
              await deleteTempSession(path);
              setTempSessions((prev) => prev.filter((s) => s.path !== path));
            } catch {
              toast.error(t('sessions.sidebar.tempSession.archiveError'));
            }
          }}
          onCreateTempSession={handleNewTempSession}
          collapsed={tempSessionsCollapsed}
          onToggleCollapse={() => {
            setTempSessionsCollapsed((prev) => {
              const next = !prev;
              try {
                getSafeStorage().setItem('oc.tempSessions.collapsed', String(next));
              } catch {
                void 0;
              }
              return next;
            });
          }}
          isSubmitting={tempDraftSubmitting}
        />
      )}

      <SidebarFooter
        onOpenSettings={handleOpenSettings}
        onOpenShortcuts={toggleHelpDialog}
        onOpenAbout={() => setAboutDialogOpen(true)}
        onOpenUpdate={handleOpenUpdateDialog}
        showRuntimeButtons={!isVSCode}
        showUpdateButton={showSidebarUpdateButton}
      />

      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        info={updateStore.info}
        downloading={updateStore.downloading}
        downloaded={updateStore.downloaded}
        progress={updateStore.progress}
        error={updateStore.error}
        onDownload={updateStore.downloadUpdate}
        onRestart={updateStore.restartToUpdate}
        runtimeType={updateStore.runtimeType}
      />

      {editingProject ? (
        <ProjectEditDialog
          open={Boolean(editingProject)}
          onOpenChange={(open) => {
            if (!open) {
              setEditingProjectDialogId(null);
            }
          }}
          projectId={editingProject.id}
          projectName={editingProject.label || formatDirectoryName(editingProject.path, homeDirectory)}
          projectPath={editingProject.path}
          initialIcon={editingProject.icon}
          initialColor={editingProject.color}
          initialIconBackground={editingProject.iconBackground}
          onSave={handleSaveProjectEdit}
        />
      ) : null}

      <NewWorktreeDialog
        open={newWorktreeDialogOpen}
        onOpenChange={setNewWorktreeDialogOpen}
        onWorktreeCreated={(worktreePath, options) => {
          setActiveMainTab('chat');
          if (mobileVariant) {
            setSessionSwitcherOpen(false);
          }
          if (options?.sessionId) {
            setCurrentSession(options.sessionId);
            return;
          }
          openNewSessionDraft({ directoryOverride: worktreePath });
        }}
      />

      <ScheduledTasksDialog />

      <SessionDeleteConfirmDialog
        value={deleteSessionConfirm}
        setValue={setDeleteSessionConfirm}
        showDeletionDialog={showDeletionDialog}
        setShowDeletionDialog={setShowDeletionDialog}
        onConfirm={confirmDeleteSession}
      />

      <FolderDeleteConfirmDialog
        value={deleteFolderConfirm}
        setValue={setDeleteFolderConfirm}
        onConfirm={confirmDeleteFolder}
      />

      <BulkSessionDeleteConfirmDialog
        value={bulkDeleteConfirm}
        setValue={setBulkDeleteConfirm}
        showDeletionDialog={showDeletionDialog}
        setShowDeletionDialog={setShowDeletionDialog}
        onConfirm={confirmBulkDelete}
      />

      <RegenerateTitleDialog
        open={regenerateTitleSession !== null}
        onOpenChange={(open) => { if (!open) setRegenerateTitleSession(null); }}
        sessionId={regenerateTitleSession?.id ?? ''}
        sessionTitle={regenerateTitleSession?.title ?? ''}
        onApply={updateSessionTitle}
      />
    </div>
  );
};
