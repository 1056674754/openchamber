import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { canUseElectronDesktopIPC, invokeDesktop, isDesktopLocalOriginActive, listenDesktopEvent } from '@/lib/desktop';
import { desktopHostsGet, locationMatchesHost, redactSensitiveUrl } from '@/lib/desktopHosts';
import { getSyncChildStores, getAllSyncSessions } from '@/sync/sync-refs';
import { getAllSyncStores, subscribeSyncStoresRegistry } from '@/sync/multi-server-registry';
import { seedGlobalSessionStatusFromHost } from '@/sync/host-session-status-seed';
import { useNotificationStore } from '@/sync/notification-store';
import { respondToPermission } from '@/sync/session-actions';
import {
  useGlobalSessionsStore,
  ensureGlobalSessionsLoaded,
  refreshGlobalSessions,
  resolveGlobalSessionDirectory,
} from '@/stores/useGlobalSessionsStore';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { QUOTA_PROVIDERS, formatWindowLabel, formatQuotaValueLabel } from '@/lib/quota';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGitStore } from '@/stores/useGitStore';
import { useUIStore } from '@/stores/useUIStore';
import { resolveProjectForSessionDirectory, normalizeProjectPath } from '@/lib/projectResolution';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { countDockBadgeChats } from '@/sync/desktop-dock-badge';
import type { ProjectEntry } from '@/lib/api/types';
import type { WorktreeMetadata } from '@/types/worktree';
import { toast } from '@/components/ui';
import type { PermissionRequest } from '@/types/permission';
import type { QuestionRequest } from '@/types/question';
import type { ChildStoreManager } from '@/sync/child-store';

// Native tray/menu bar bridge. Electron main owns Tray UI; this hook streams a
// compact snapshot via `desktop_tray_update` and routes tray clicks back in.
// Aggregates local + remote sync stores so multi-server sessions stay correct.

const POLL_INTERVAL_MS = 5000;
const FLUSH_DEBOUNCE_MS = 120;
const GLOBAL_REFRESH_MS = 45000;
const MAX_SESSIONS = 20;

type TraySessionStatus = 'idle' | 'busy' | 'retry';

type TraySession = {
  id: string;
  title: string;
  status: TraySessionStatus;
  branch: string;
  unseen: number;
  hasError: boolean;
  directory: string;
  serverId: string;
  subtitle: string;
};

type TrayApproval = {
  kind: 'permission' | 'question';
  id: string;
  sessionId: string;
  sessionTitle: string;
  label: string;
  directory: string;
  serverId: string;
};

type TrayUsageRow = { label: string; value: string };
type TrayUsageGroup = { provider: string; rows: TrayUsageRow[]; status: string | null };
type TrayUsage = { mode: 'usage' | 'remaining'; groups: TrayUsageGroup[] };

type TraySnapshot = {
  sessions: TraySession[];
  approvals: TrayApproval[];
  instanceName: string;
  usage: TrayUsage;
  dockBadgeCount: number;
};

type TrayAction =
  | {
      type: 'respond-permission';
      sessionId: string;
      id: string;
      response: 'once' | 'always' | 'reject';
      directory?: string;
      serverId?: string;
    };

const isTrayPlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  const platform = (window as unknown as { __OPENCHAMBER_PLATFORM__?: string }).__OPENCHAMBER_PLATFORM__;
  return platform === 'darwin' || platform === 'win32';
};

const isTrayEnabled = (): boolean =>
  typeof window !== 'undefined' && window.__OPENCHAMBER_ELECTRON__?.trayEnabled !== false;

const permissionLabel = (request: PermissionRequest): string => {
  const head = typeof request.permission === 'string' ? request.permission : 'Permission';
  const pattern = Array.isArray(request.patterns) ? request.patterns.find((p) => typeof p === 'string' && p.trim()) : '';
  return pattern ? `${head}: ${pattern}` : head;
};

const questionLabel = (request: QuestionRequest): string => {
  const first = Array.isArray(request.questions) ? request.questions[0] : undefined;
  return first?.header || first?.question || 'Question';
};

const updatedAt = (session: Session): number =>
  session.time?.updated ?? session.time?.created ?? 0;

const basenameOf = (p: string): string => {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
};

const resolveSessionServerId = (sessionId: string, fallback?: string | null): string =>
  serverRegistry.getServerForSession(sessionId)
  || (fallback && fallback.trim().length > 0 ? fallback.trim() : DEFAULT_SERVER_ID);

const resolveSessionSubtitle = (
  directory: string,
  session: Session,
  projects: ProjectEntry[],
  worktreesByProject: Map<string, WorktreeMetadata[]>,
  branchByDirectory: Map<string, string>,
): string => {
  if (!directory) return '';
  const project = resolveProjectForSessionDirectory(projects, worktreesByProject, directory);
  const globalProjectName = (session as { project?: { name?: string } | null }).project?.name;
  const projectName = project?.label?.trim() || globalProjectName?.trim() || basenameOf(directory);
  const normDir = normalizeProjectPath(directory);

  let branch = (normDir && branchByDirectory.get(normDir)) || '';
  if (!branch) {
    for (const [dir, gitState] of useGitStore.getState().directories) {
      if (normalizeProjectPath(dir) === normDir) { branch = gitState.status?.current ?? ''; break; }
    }
  }
  if (!branch) {
    for (const worktrees of worktreesByProject.values()) {
      const match = worktrees.find((wt) => normalizeProjectPath(wt.path) === normDir);
      if (match?.branch) { branch = match.branch; break; }
    }
  }

  return branch ? `${projectName} · ${branch}` : projectName;
};

const buildUsage = (): TrayUsage => {
  const { results, dropdownProviderIds, displayMode } = useQuotaStore.getState();
  const mode: TrayUsage['mode'] = displayMode === 'remaining' ? 'remaining' : 'usage';
  if (!dropdownProviderIds.length) return { mode, groups: [] };

  const byProvider = new Map(results.map((result) => [result.providerId, result]));
  const groups: TrayUsageGroup[] = [];
  for (const meta of QUOTA_PROVIDERS) {
    if (!dropdownProviderIds.includes(meta.id)) continue;
    const result = byProvider.get(meta.id);
    if (!result || result.configured !== true) continue;

    const rows: TrayUsageRow[] = [];
    for (const [label, window] of Object.entries(result.usage?.windows ?? {})) {
      const percent = mode === 'remaining' ? window.remainingPercent : window.usedPercent;
      rows.push({ label: formatWindowLabel(label), value: formatQuotaValueLabel(window.valueLabel, percent) });
    }

    const status = !result.ok && result.error
      ? result.error
      : rows.length === 0
        ? 'No rate limits reported'
        : null;
    groups.push({ provider: meta.name, rows, status });
  }
  return { mode, groups };
};

const resolveInstanceName = async (): Promise<string> => {
  try {
    if (isDesktopLocalOriginActive()) return 'Local OpenChamber';
    const origin = window.location.origin;
    const cfg = await desktopHostsGet();
    const match = cfg.hosts.find((host) => locationMatchesHost(origin, host.url));
    if (match?.label?.trim()) return redactSensitiveUrl(match.label.trim());
    return 'Instance';
  } catch {
    return '';
  }
};

type LiveData = {
  statusById: Map<string, TraySessionStatus>;
  branchByDirectory: Map<string, string>;
  approvals: TrayApproval[];
  titleById: Map<string, string>;
};

const collectFromManager = (
  serverId: string,
  manager: ChildStoreManager,
  statusById: Map<string, TraySessionStatus>,
  branchByDirectory: Map<string, string>,
  approvals: TrayApproval[],
  titleById: Map<string, string>,
): void => {
  for (const [directory, store] of manager.children.entries()) {
    const state = store.getState();
    if (state.vcs?.branch) {
      branchByDirectory.set(normalizeProjectPath(directory) ?? directory, state.vcs.branch);
    }

    for (const session of state.session) {
      if (!session?.id) continue;
      titleById.set(session.id, session.title);
    }

    for (const [sessionId, status] of Object.entries(state.session_status ?? {})) {
      const type = status?.type;
      const mapped: TraySessionStatus = type === 'busy' ? 'busy' : type === 'retry' ? 'retry' : 'idle';
      const existing = statusById.get(sessionId);
      if (!existing || existing === 'idle') statusById.set(sessionId, mapped);
    }

    for (const [sessionId, requests] of Object.entries(state.permission ?? {})) {
      for (const request of requests ?? []) {
        if (!request?.id) continue;
        const sid = request.sessionID || sessionId;
        approvals.push({
          kind: 'permission',
          id: request.id,
          sessionId: sid,
          sessionTitle: '',
          label: permissionLabel(request),
          directory,
          serverId: resolveSessionServerId(sid, serverId),
        });
      }
    }
    for (const [sessionId, requests] of Object.entries(state.question ?? {})) {
      for (const request of requests ?? []) {
        if (!request?.id) continue;
        const sid = request.sessionID || sessionId;
        approvals.push({
          kind: 'question',
          id: request.id,
          sessionId: sid,
          sessionTitle: '',
          label: questionLabel(request),
          directory,
          serverId: resolveSessionServerId(sid, serverId),
        });
      }
    }
  }
};

const collectLiveData = (): LiveData => {
  const statusById = new Map<string, TraySessionStatus>();
  const branchByDirectory = new Map<string, string>();
  const approvals: TrayApproval[] = [];
  const titleById = new Map<string, string>();
  const seenManagers = new Set<ChildStoreManager>();

  try {
    const defaultStores = getSyncChildStores();
    seenManagers.add(defaultStores);
    collectFromManager(DEFAULT_SERVER_ID, defaultStores, statusById, branchByDirectory, approvals, titleById);
  } catch {
    // Sync provider not mounted yet.
  }

  for (const entry of getAllSyncStores()) {
    if (seenManagers.has(entry.childStores)) continue;
    seenManagers.add(entry.childStores);
    collectFromManager(entry.serverId, entry.childStores, statusById, branchByDirectory, approvals, titleById);
  }

  return { statusById, branchByDirectory, approvals, titleById };
};

const collectStatusPollDirectories = (): string[] => {
  const allSessions = useGlobalSessionsStore.getState().activeSessions;
  const rootDirs = new Set<string>();
  allSessions
    .filter((s) => s?.id && !s.parentID)
    .slice()
    .sort((a, b) => updatedAt(b) - updatedAt(a))
    .slice(0, MAX_SESSIONS)
    .forEach((session) => {
      const directory = resolveGlobalSessionDirectory(session);
      if (directory) rootDirs.add(directory);
    });
  return Array.from(rootDirs);
};

const buildSnapshot = (instanceName: string, includeTray: boolean): TraySnapshot => {
  const notif = useNotificationStore.getState().index.session;
  const allSessions = useGlobalSessionsStore.getState().activeSessions;
  const ui = useUIStore.getState();
  const childrenByParent = new Map<string, string[]>();

  for (const session of allSessions) {
    if (!session?.id) continue;
    if (session.parentID) {
      const siblings = childrenByParent.get(session.parentID) ?? [];
      siblings.push(session.id);
      childrenByParent.set(session.parentID, siblings);
    }
  }

  const collectDescendants = (rootId: string): string[] => {
    const out: string[] = [];
    const stack = [...(childrenByParent.get(rootId) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      stack.push(...(childrenByParent.get(id) ?? []));
    }
    return out;
  };

  // Count the full root list, independently of the tray's visibility and limit.
  const dockBadgeCount = ui.dockBadgeEnabled
    ? countDockBadgeChats({
        sessions: allSessions,
        unseenCount: notif.unseenCount,
        notifyOnSubtasks: ui.notifyOnSubtasks,
      })
    : 0;

  if (!includeTray) {
    return { sessions: [], approvals: [], instanceName, usage: { mode: 'usage', groups: [] }, dockBadgeCount };
  }

  const live = collectLiveData();
  const globalStatuses = useGlobalSessionsStore.getState().sessionStatuses;
  const titleById = new Map<string, string>(live.titleById);
  for (const session of allSessions) {
    if (session?.id && session.title) titleById.set(session.id, session.title);
  }

  const resolveStatus = (id: string): TraySessionStatus => {
    const fromStores = live.statusById.get(id);
    if (fromStores && fromStores !== 'idle') return fromStores;
    const globalType = globalStatuses.get(id)?.type;
    if (globalType === 'busy' || globalType === 'retry') return globalType;
    return fromStores ?? 'idle';
  };

  const rollupStatus = (family: string[]): TraySessionStatus => {
    const statuses = family.map((id) => resolveStatus(id));
    if (statuses.includes('busy')) return 'busy';
    if (statuses.includes('retry')) return 'retry';
    return 'idle';
  };

  const projects = useProjectsStore.getState().projects;
  const worktreesByProject = useSessionUIStore.getState().availableWorktreesByProject;

  const sessions: TraySession[] = allSessions
    .filter((s) => s?.id && !s.parentID)
    .slice()
    .sort((a, b) => updatedAt(b) - updatedAt(a))
    .slice(0, MAX_SESSIONS)
    .map((session) => {
      const family = [session.id, ...collectDescendants(session.id)];
      const directory = resolveGlobalSessionDirectory(session) ?? '';
      const serverId = resolveSessionServerId(session.id);
      const normDir = normalizeProjectPath(directory) ?? directory;
      return {
        id: session.id,
        title: session.title || 'Untitled session',
        status: rollupStatus(family),
        branch: normDir ? (live.branchByDirectory.get(normDir) ?? '') : '',
        unseen: family.reduce((sum, id) => sum + (notif.unseenCount[id] ?? 0), 0),
        hasError: family.some((id) => notif.unseenHasError[id] ?? false),
        directory,
        serverId,
        subtitle: resolveSessionSubtitle(directory, session, projects, worktreesByProject, live.branchByDirectory),
      };
    });

  const approvals = live.approvals.map((a) => ({ ...a, sessionTitle: titleById.get(a.sessionId) || '' }));

  return { sessions, approvals, instanceName, usage: buildUsage(), dockBadgeCount };
};

export const useTraySync = (): void => {
  React.useEffect(() => {
    if (!isTrayPlatform() || !canUseElectronDesktopIPC()) return;
    const trayEnabled = isTrayEnabled();

    let disposed = false;
    let lastSerialized = '';
    let flushTimer: number | null = null;
    let instanceName = '';

    const flushNow = () => {
      if (disposed) return;
      const snapshot = buildSnapshot(instanceName, trayEnabled);
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      void invokeDesktop('desktop_tray_update', snapshot);
    };

    const scheduleFlush = () => {
      if (disposed || flushTimer !== null) return;
      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        flushNow();
      }, FLUSH_DEBOUNCE_MS);
    };

    const unsubscribeNotif = useNotificationStore.subscribe(() => scheduleFlush());
    const unsubscribeGlobal = useGlobalSessionsStore.subscribe(() => scheduleFlush());
    // The dock-badge toggle and subtask-notification preference live here; a
    // change must re-push the snapshot so the badge appears/clears immediately.
    const unsubscribeUI = useUIStore.subscribe((state, previous) => {
      if (state.dockBadgeEnabled !== previous.dockBadgeEnabled || state.notifyOnSubtasks !== previous.notifyOnSubtasks) scheduleFlush();
    });
    const stopBadgeSync = () => {
      disposed = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      unsubscribeNotif();
      unsubscribeGlobal();
      unsubscribeUI();
    };

    // Dock badges share the desktop_tray_update command but stay active when
    // the menu bar is disabled: observe unread state only, without tray
    // polling, quotas, or directory listeners.
    if (!trayEnabled) {
      flushNow();
      return stopBadgeSync;
    }

    void resolveInstanceName().then((name) => {
      if (disposed) return;
      instanceName = name;
      flushNow();
    });

    const refreshGlobalStatus = async () => {
      // The host's own cross-project map answers in one request and creates
      // no OpenCode instance, so the default server never gets a
      // per-directory `/session/status` fan-out from here.
      void seedGlobalSessionStatusFromHost();
      const directories = collectStatusPollDirectories();
      if (directories.length === 0) return;
      await useGlobalSessionsStore.getState().batchLoadStatuses(directories, { excludeServerId: DEFAULT_SERVER_ID });
    };

    const storeUnsubs = new Map<string, () => void>();

    const rebindStores = () => {
      if (disposed) return;
      const live = new Set<string>();
      const managers: Array<{ key: string; manager: ChildStoreManager }> = [];

      try {
        managers.push({ key: `${DEFAULT_SERVER_ID}`, manager: getSyncChildStores() });
      } catch {
        // Sync provider not mounted yet.
      }
      for (const entry of getAllSyncStores()) {
        managers.push({ key: entry.serverId, manager: entry.childStores });
      }

      for (const { key, manager } of managers) {
        for (const [directory, store] of manager.children.entries()) {
          const bindKey = `${key}\n${directory}`;
          live.add(bindKey);
          if (!storeUnsubs.has(bindKey)) {
            storeUnsubs.set(bindKey, store.subscribe(() => scheduleFlush()));
          }
        }
      }

      for (const [bindKey, unsub] of storeUnsubs) {
        if (!live.has(bindKey)) {
          unsub();
          storeUnsubs.delete(bindKey);
        }
      }
    };

    let unsubscribeDefaultRegistry: (() => void) | null = null;
    try {
      unsubscribeDefaultRegistry = getSyncChildStores().subscribeRegistry(() => {
        rebindStores();
        scheduleFlush();
      });
    } catch {
      // Sync provider not mounted yet.
    }
    const unsubscribeRemoteRegistry = subscribeSyncStoresRegistry(() => {
      rebindStores();
      scheduleFlush();
    });
    rebindStores();

    const unsubscribeProjects = useProjectsStore.subscribe(() => scheduleFlush());
    const unsubscribeWorktrees = useSessionUIStore.subscribe(() => scheduleFlush());
    const unsubscribeGit = useGitStore.subscribe(() => scheduleFlush());
    const unsubscribeQuota = useQuotaStore.subscribe(() => scheduleFlush());

    void ensureGlobalSessionsLoaded(getAllSyncSessions());
    const refreshInterval = window.setInterval(() => { void refreshGlobalSessions(); }, GLOBAL_REFRESH_MS);

    void refreshGlobalStatus();
    const globalStatusInterval = window.setInterval(() => { void refreshGlobalStatus(); }, POLL_INTERVAL_MS);

    void useQuotaStore.getState().loadSettings().then(() => {
      if (disposed) return;
      const { dropdownProviderIds, results } = useQuotaStore.getState();
      const needsFetch = dropdownProviderIds.length > 0
        && dropdownProviderIds.some((id) => !results.some((r) => r.providerId === id));
      if (needsFetch) void useQuotaStore.getState().fetchAllQuotas();
    });
    const usageRefreshTick = window.setInterval(() => {
      const quota = useQuotaStore.getState();
      if (quota.autoRefresh && quota.dropdownProviderIds.length > 0) void quota.fetchAllQuotas();
    }, Math.max(30000, useQuotaStore.getState().refreshIntervalMs || 60000));

    const interval = window.setInterval(() => { rebindStores(); flushNow(); }, POLL_INTERVAL_MS);
    flushNow();

    return () => {
      stopBadgeSync();
      window.clearInterval(interval);
      window.clearInterval(refreshInterval);
      window.clearInterval(globalStatusInterval);
      window.clearInterval(usageRefreshTick);
      unsubscribeProjects();
      unsubscribeWorktrees();
      unsubscribeGit();
      unsubscribeQuota();
      unsubscribeDefaultRegistry?.();
      unsubscribeRemoteRegistry();
      for (const unsub of storeUnsubs.values()) unsub();
      storeUnsubs.clear();
    };
  }, []);

  React.useEffect(() => {
    if (!isTrayPlatform() || !isTrayEnabled() || !canUseElectronDesktopIPC() || typeof window === 'undefined') return;

    const handle = (action: TrayAction) => {
      switch (action.type) {
        case 'respond-permission':
          void respondToPermission(action.sessionId, action.id, action.response, {
            directory: action.directory,
            serverId: action.serverId || serverRegistry.getServerForSession(action.sessionId),
          }).catch(() => {
            toast.error('Failed to respond to permission request');
          });
          break;
      }
    };

    let unlisten: null | (() => void) = null;
    void listenDesktopEvent('openchamber:tray-action', (evt) => {
      const action = evt?.payload as TrayAction | undefined;
      if (!action || typeof action !== 'object' || typeof action.type !== 'string') return;
      handle(action);
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => {});

    return () => {
      try {
        unlisten?.();
      } catch {
        // ignore
      }
    };
  }, []);
};
