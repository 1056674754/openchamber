import { HostRequestError, type GuestLoadState, type GuestSessionRecord, type GuestWorkspaceQuery, type GuestWorkspaceSnapshot, type GuestWorktree } from '@openchamber/sdk';
import type { Session } from '@opencode-ai/sdk/v2';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useGlobalSessionStatusStore } from '@/sync/global-session-status';
import { getAllSyncSessionMap, getDirectoryState, getSyncChildStores } from '@/sync/sync-refs';
import { getLinkedIssues } from '@/lib/linkedIssues';
import { normalizePath } from '@/lib/pathNormalization';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { useUIStore } from '@/stores/useUIStore';
import type { WorktreeMetadata } from '@/types/worktree';

export const guestProject = (projectId: string) => {
  const state = useProjectsStore.getState();
  if (!state.hasServerSnapshot) throw new HostRequestError('HOST_UNAVAILABLE', 'The project registry has not loaded.');
  const project = state.projects.find((entry) => entry.id === projectId);
  if (!project) throw new HostRequestError('NOT_FOUND', 'Project is not registered.');
  return project;
};
export const guestProjectWorktrees = (directory: string): WorktreeMetadata[] => (
  useSessionUIStore.getState().availableWorktreesByProject.get(normalizePath(directory) ?? directory) ?? []
);
const toWorktree = (entry: WorktreeMetadata): GuestWorktree => ({
  directory: entry.path, name: entry.name ?? entry.label, branch: entry.branch,
  status: entry.worktreeStatus === 'not-a-repo' ? 'invalid' : entry.worktreeStatus ?? 'ready',
});
const combinedState = (states: GuestLoadState[]): GuestLoadState => states.includes('error') ? 'error' : states.includes('loading') ? 'loading' : 'ready';

const projectSession = (session: Session, projectId: string, guestId: string, worktrees: ReadonlyMap<string, GuestWorktree>): GuestSessionRecord => {
  const directory = session.directory;
  const child = getDirectoryState(directory);
  const live = useGlobalSessionStatusStore.getState();
  const globalStatus = live.statusById.get(session.id);
  const status = (globalStatus && normalizePath(globalStatus.directory) === normalizePath(directory) ? globalStatus.status : undefined) ?? child?.session_status[session.id];
  const observation = live.observedById.get(session.id);
  const observed = observation && normalizePath(observation.directory) === normalizePath(directory) ? observation : undefined;
  const attached = useSessionUIStore.getState().worktreeMetadata.get(session.id);
  const worktree = worktrees.get(normalizePath(directory) ?? directory)
    ?? (attached && normalizePath(attached.path) === normalizePath(directory) ? toWorktree(attached) : null);
  const connected = useConfigStore.getState().isConnected;
  let activity: GuestSessionRecord['activity'] = 'unknown';
  if (connected) {
    if (status?.type === 'busy') activity = 'running';
    else if (status?.type === 'retry') activity = 'retrying';
    // [fork-port] The fork's per-directory child store carries no
    // `sessionStatusReady` flag, so idle detection rides the global status
    // channel and observations only.
    else if (status?.type === 'idle' || observed) activity = 'idle';
    if (child?.permission[session.id]?.length) activity = 'waiting-permission';
    else if (child?.question[session.id]?.length) activity = 'waiting-question';
  }
  return {
    id: session.id, title: session.title || session.id, projectId, directory,
    parentId: session.parentID ?? null, createdAt: session.time.created, updatedAt: session.time.updated,
    archivedAt: session.time.archived || null, worktree,
    activity, outcome: activity === 'idle' ? observed?.outcome ?? null : null,
    items: getLinkedIssues(session).flatMap((item) => {
      if (item.kind !== 'guest' || item.providerId !== guestId) return [];
      const reference: GuestSessionRecord['items'][number] = { id: item.identifier };
      if (item.data !== undefined) reference.data = item.data;
      return [reference];
    }),
  };
};

/** Store projection only. Layout-owned sync and topology discovery supply hydration. */
export const readGuestWorkspace = (query: GuestWorkspaceQuery, guestId: string): GuestWorkspaceSnapshot => {
  const projects = useProjectsStore.getState();
  if (query.kind === 'projects') return {
    kind: 'projects', state: projects.serverSnapshotFailed ? 'error' : projects.hasServerSnapshot ? 'ready' : 'loading',
    projects: projects.hasServerSnapshot ? projects.projects.map((project) => ({ id: project.id, name: project.label || project.path.split('/').pop() || project.path, directory: project.path })) : [],
  };
  const project = projects.projects.find((entry) => entry.id === query.projectId);
  const topology = useSessionUIStore.getState();
  const path = project ? normalizePath(project.path) ?? project.path : '';
  const topologyState = project ? topology.worktreeDiscoveryByProject.get(path) ?? 'loading' : projects.hasServerSnapshot ? 'error' : 'loading';
  const worktrees = project ? guestProjectWorktrees(project.path).map(toWorktree) : [];
  if (query.kind === 'worktrees') return { ...query, state: topologyState, worktrees };
  const directories = new Set(project ? [path, ...worktrees.map((worktree) => normalizePath(worktree.directory) ?? worktree.directory)] : []);
  const global = useGlobalSessionsStore.getState();
  // [fork-port] The fork's sync layer has no per-directory bootstrap state
  // machine; coverage rides the global session load status instead.
  const coverage = [...directories].map((directory) => {
    const state: GuestLoadState = global.status === 'error' ? 'error' : global.status === 'ready' ? 'ready' : 'loading';
    return { directory, state };
  });
  const records = new Map<string, Session>();
  // Global records own complete membership, including archives. Child stores fill discovery gaps.
  for (const directory of directories) {
    for (const session of global.sessionsByDirectory.get(directory) ?? []) {
      records.set(session.id, session);
    }
  }
  for (const session of global.archivedSessions) {
    if (directories.has(normalizePath(session.directory) ?? session.directory)) records.set(session.id, session);
  }
  for (const directory of directories) {
    for (const session of getDirectoryState(directory)?.session ?? []) {
      if (directories.has(normalizePath(session.directory) ?? session.directory)) {
        if (!records.has(session.id)) records.set(session.id, session);
      }
    }
  }
  const worktreeByPath = new Map(worktrees.map((worktree) => [normalizePath(worktree.directory) ?? worktree.directory, worktree]));
  return { ...query, state: combinedState([topologyState, ...coverage.map((entry) => entry.state)]), coverage,
    sessions: [...records.values()].map((session) => projectSession(session, query.projectId, guestId, worktreeByPath)) };
};

type Observer = { listeners: Set<(snapshot: GuestWorkspaceSnapshot) => void>; snapshot: GuestWorkspaceSnapshot; dispose: () => void };
const observers = new Map<string, Observer>();

/** One projection/subscription set per extension and query, shared by its frames. */
export const observeGuestWorkspace = (query: GuestWorkspaceQuery, guestId: string, listener: (snapshot: GuestWorkspaceSnapshot) => void): (() => void) => {
  const key = JSON.stringify([getRuntimeKey(), guestId, query]);
  let observer = observers.get(key);
  if (!observer) {
    const listeners = new Set<(snapshot: GuestWorkspaceSnapshot) => void>();
    const current: Observer = { listeners, snapshot: readGuestWorkspace(query, guestId), dispose: () => {} };
    let queued = false;
    let disposed = false;
    let serialized = JSON.stringify(current.snapshot);
    const update = () => {
      if (queued || disposed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        const next = readGuestWorkspace(query, guestId);
        const json = JSON.stringify(next);
        if (json === serialized) return;
        serialized = json;
        current.snapshot = next;
        for (const notify of listeners) notify(next);
      });
    };
    const unsubs = [useProjectsStore.subscribe((state, previous) => {
      if (state.projects !== previous.projects || state.hasServerSnapshot !== previous.hasServerSnapshot || state.serverSnapshotFailed !== previous.serverSnapshotFailed) update();
    })];
    if (query.kind !== 'projects') unsubs.push(useSessionUIStore.subscribe((state, previous) => {
      if (state.availableWorktreesByProject !== previous.availableWorktreesByProject || state.worktreeDiscoveryByProject !== previous.worktreeDiscoveryByProject || state.worktreeMetadata !== previous.worktreeMetadata) update();
    }));
    if (query.kind === 'sessions') {
      const manager = getSyncChildStores();
      unsubs.push(
        useGlobalSessionsStore.subscribe((state, previous) => { if (state.activeSessions !== previous.activeSessions || state.archivedSessions !== previous.archivedSessions || state.status !== previous.status) update(); }),
        useGlobalSessionStatusStore.subscribe(update),
        useConfigStore.subscribe((state, previous) => { if (state.isConnected !== previous.isConnected) update(); }),
        // [fork-port] The fork's ChildStoreManager exposes a single
        // whole-state subscription instead of per-slice bootstrap selectors.
        manager.subscribeAll(update),
      );
    }
    current.dispose = () => { disposed = true; for (const unsubscribe of unsubs) unsubscribe(); observers.delete(key); };
    unsubs.push(subscribeRuntimeEndpointChanged(current.dispose));
    observers.set(key, current);
    observer = current;
  }
  observer.listeners.add(listener);
  listener(observer.snapshot);
  const current = observer;
  return () => { current.listeners.delete(listener); if (current.listeners.size === 0) current.dispose(); };
};

export const openGuestSession = (sessionId: string): void => {
  // [fork-port] The fork's global store keeps plain session arrays rather than
  // an entity map, so the fallback scans active and archived lists.
  const global = useGlobalSessionsStore.getState();
  const session = getAllSyncSessionMap().get(sessionId)
    ?? global.activeSessions.find((entry) => entry.id === sessionId)
    ?? global.archivedSessions.find((entry) => entry.id === sessionId);
  if (!session?.directory) throw new HostRequestError('NO_SESSION', 'Session is not available.');
  useSessionUIStore.getState().setCurrentSession(sessionId, session.directory);
  useUIStore.getState().closeMainSurfaces();
};
