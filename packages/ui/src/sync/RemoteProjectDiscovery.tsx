import { useEffect, useRef, type MutableRefObject } from "react";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { serverRegistry, DEFAULT_SERVER_ID, type ServerConnection } from "@/lib/opencode/server-registry";
import { setDirectoryServerId } from "./session-routing";
import { useSessionUIStore } from "./session-ui-store";
import { resolveApiUrl } from "@/lib/api/serverUrl";
import { dedupeWorktreesByPath, getProjectWorktreeKey, getWorktreesForProject } from "@/lib/worktrees/worktreeKeys";
import type { WorktreeMetadata } from "@/types/worktree";
import { getRemoteProjectDiscoveryKey, normalizeRemoteProjectDiscoveryPath } from "./remote-project-discovery-key";

const AVAILABLE_PROJECT_PROBE_TTL_MS = 30_000;
const UNAVAILABLE_PROJECT_RETRY_MS = 5_000;
const REMOTE_PROJECT_LIST_TIMEOUT_MS = 8_000;

type AvailabilityProbeRecord = {
  inFlight: boolean;
  lastCheckedAt: number;
  unavailable: boolean;
};

const normalizeRemoteProjectPath = (value: string): string => {
  return normalizeRemoteProjectDiscoveryPath(value);
};

const shouldSkipRemoteProjectPath = (value: string): boolean => {
  return normalizeRemoteProjectPath(value) === "/";
};

export function RemoteProjectDiscovery() {
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const knownDirs = useRef(new Set<string>());
  const probedServers = useRef(new Set<string>()); // [OPENCHAMBER-FORK] track worktree discovery per server
  const availabilityProbes = useRef(new Map<string, AvailabilityProbeRecord>());
  const worktreeDiscoveryInFlight = useRef(new Set<string>());
  const pendingProjects = useRef(new Map<string, { path: string; serverId: string }>());
  const flushTimer = useRef<number | null>(null);
  const discoveryRetryTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const storeUnsubs = new Map<string, () => void>();
    const healthUnsubs = new Map<string, () => void>();
    const pendingProjectQueue = pendingProjects.current;
    const retryTimers = discoveryRetryTimers.current;

    const scheduleDiscoveryRetry = (serverId: string) => {
      if (probedServers.current.has(serverId)) return;
      if (retryTimers.has(serverId)) return;

      const timer = window.setTimeout(() => {
        retryTimers.delete(serverId);
        if (!probedServers.current.has(serverId)) {
          discover();
        }
      }, UNAVAILABLE_PROJECT_RETRY_MS);
      retryTimers.set(serverId, timer);
    };

    const queueRemoteProject = (path: string, serverId: string) => {
      if (shouldSkipRemoteProjectPath(path)) return;
      const key = getRemoteProjectDiscoveryKey(serverId, path);
      pendingProjectQueue.set(key, { path, serverId });
      if (flushTimer.current !== null) return;
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        const queued = [...pendingProjectQueue.values()];
        pendingProjectQueue.clear();
        for (const item of queued) {
          ensureRemoteProject(item.path, item.serverId);
        }
      }, 0);
    };

    const ensureHealthSubscription = (serverId: string) => {
      if (healthUnsubs.has(serverId)) return;
      healthUnsubs.set(
        serverId,
        serverRegistry.onHealthChange(serverId, (status) => {
          if (status === "healthy" && !probedServers.current?.has(serverId)) {
            discover();
          }
        }),
      );
    };

    const syncStoreSubscriptions = (entries: ReturnType<typeof getAllSyncStores>) => {
      const activeKeys = new Set<string>();
      for (const entry of entries) {
        if (entry.serverId === DEFAULT_SERVER_ID) continue;
        ensureHealthSubscription(entry.serverId);

        for (const [directory, childStore] of entry.childStores.children) {
          const key = getRemoteProjectDiscoveryKey(entry.serverId, directory);
          activeKeys.add(key);
          if (!storeUnsubs.has(key)) {
            storeUnsubs.set(key, childStore.subscribe(discover));
          }
        }
      }

      for (const [key, unsubscribe] of storeUnsubs) {
        if (!activeKeys.has(key)) {
          unsubscribe();
          storeUnsubs.delete(key);
        }
      }
    };

    const discover = () => {
      const entries = getAllSyncStores();
      syncStoreSubscriptions(entries);
      const store = useProjectsStore.getState();
      for (const entry of entries) {
        if (entry.serverId === DEFAULT_SERVER_ID) continue;
        for (const store of entry.childStores.children.values()) {
          const state = store.getState();
          const dirSessions = new Map<string, string[]>();
          for (const session of state.session) {
            if (!session.id) continue;
            const dir = (session as { directory?: string }).directory;
            if (!dir) continue;
            let list = dirSessions.get(dir);
            if (!list) {
              list = [];
              dirSessions.set(dir, list);
            }
            list.push(session.id);
          }
          for (const [dir] of dirSessions) {
            const key = getRemoteProjectDiscoveryKey(entry.serverId, dir);
            if (knownDirs.current.has(key)) continue;
            knownDirs.current.add(key);
            setDirectoryServerId(dir, entry.serverId);
            queueRemoteProject(dir, entry.serverId);
          }
        }

        probeRemoteProjectAvailability(entry.serverId, store.projects, availabilityProbes);
        // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
        // Probe remote sessions to discover worktree directories not yet registered as projects.
        discoverWorktreeDirectories(
          entry.serverId,
          store.projects,
          queueRemoteProject,
          probedServers,
          worktreeDiscoveryInFlight,
          scheduleDiscoveryRetry,
        );
      }
    };

    discover();
    const unsubRegistry = subscribeSyncStoresRegistry(discover);

    return () => {
      unsubRegistry();
      for (const unsubscribe of storeUnsubs.values()) unsubscribe();
      for (const unsubscribe of healthUnsubs.values()) unsubscribe();
      if (flushTimer.current !== null) {
        window.clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      for (const timer of retryTimers.values()) {
        window.clearTimeout(timer);
      }
      pendingProjectQueue.clear();
      retryTimers.clear();
      storeUnsubs.clear();
      healthUnsubs.clear();
    };
  }, [ensureRemoteProject]);

  return null;
}

async function probeRemoteProjectAvailability(
  serverId: string,
  projects: ReadonlyArray<{ id: string; serverId?: string; path: string; unavailable?: boolean }>,
  availabilityProbes: MutableRefObject<Map<string, AvailabilityProbeRecord>>,
) {
  const connection = serverRegistry.get(serverId);
  if (!connection || connection.healthStatus !== 'healthy') return;

  const remoteProjects = projects.filter(
    (p) => p.serverId === serverId,
  );
  if (remoteProjects.length === 0) return;

  const baseUrl = connection.config.baseUrl;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (connection.config.authToken) {
    headers['Authorization'] = `Bearer ${connection.config.authToken}`;
  }

  const markProjectAvailability = useProjectsStore.getState().markProjectAvailability;

  for (const project of remoteProjects) {
    if (shouldSkipRemoteProjectPath(project.path)) continue;
    const currentlyUnavailable = project.unavailable === true;
    const probeKey = `${serverId}:${project.id}:${project.path}`;
    const cached = availabilityProbes.current.get(probeKey);
    const now = Date.now();
    const retryMs = currentlyUnavailable
      ? UNAVAILABLE_PROJECT_RETRY_MS
      : AVAILABLE_PROJECT_PROBE_TTL_MS;

    if (cached?.inFlight) continue;
    if (
      cached &&
      cached.unavailable === currentlyUnavailable &&
      now - cached.lastCheckedAt < retryMs
    ) {
      continue;
    }

    availabilityProbes.current.set(probeKey, {
      inFlight: true,
      lastCheckedAt: cached?.lastCheckedAt ?? 0,
      unavailable: currentlyUnavailable,
    });

    let available = !currentlyUnavailable;
    try {
      const res = await fetch(
        `${resolveApiUrl('/api/fs/list', baseUrl)}?path=${encodeURIComponent(project.path)}`,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      available = res.ok || (res.status >= 500 && res.status < 600);
      if (available !== !currentlyUnavailable) {
        markProjectAvailability(
          project.id,
          available,
        );
      }
    } catch {
      // Network/browser resource failures are transient. Do not persist them as
      // project unavailability; that would suppress remote bootstrap entirely.
      available = !currentlyUnavailable;
    } finally {
      availabilityProbes.current.set(probeKey, {
        inFlight: false,
        lastCheckedAt: Date.now(),
        unavailable: !available,
      });
    }
  }
}

// [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
// Use project.list() to discover ALL directories on the remote server (including worktrees).
// session.list() only returns sessions for a specific directory, so it can't find worktrees.
// project.list() returns all projects with their worktree paths.
async function discoverWorktreeDirectories(
  serverId: string,
  projects: ReadonlyArray<{ id: string; serverId?: string; path: string; unavailable?: boolean }>,
  ensureRemoteProject: (path: string, serverId: string, label?: string) => unknown,
  probedServers: MutableRefObject<Set<string>>,
  inFlightServers: MutableRefObject<Set<string>>,
  scheduleDiscoveryRetry: (serverId: string) => void,
) {
  const connection = serverRegistry.get(serverId);
  if (!connection || connection.healthStatus !== 'healthy') return;
  if (probedServers.current?.has(serverId)) return;
  if (inFlightServers.current?.has(serverId)) return;

  const knownProjectKeys = new Set(
    projects
      .filter((p) => p.serverId === serverId)
      .map((p) => getRemoteProjectDiscoveryKey(serverId, p.path)),
  );

  inFlightServers.current?.add(serverId);
  try {
    const data = await fetchRemoteProjectList(connection);
    if (!Array.isArray(data)) {
      scheduleDiscoveryRetry(serverId);
      return;
    }

    const toRegister: Array<{ path: string; serverId: string }> = [];
    const worktreesByProject = new Map<string, WorktreeMetadata[]>();
    const currentByProject = useSessionUIStore.getState().availableWorktreesByProject;
    let listedDirectoryCount = 0;

    for (const p of data) {
      if (typeof p !== "object" || p === null) continue;
      if ((p as { id?: string }).id === "global") continue;

      const mainWorktree = (p as { worktree?: string }).worktree;
      const sandboxes = ((p as { sandboxes?: string[] }).sandboxes ?? [])
        .filter((d): d is string => Boolean(d) && !shouldSkipRemoteProjectPath(d));

      // Register main project path (parent) as a project — existing behaviour.
      const mainWorktreeKey = mainWorktree
        ? getRemoteProjectDiscoveryKey(serverId, mainWorktree)
        : "";
      if (mainWorktree && !shouldSkipRemoteProjectPath(mainWorktree)) {
        listedDirectoryCount += 1;
      }
      if (mainWorktree && !shouldSkipRemoteProjectPath(mainWorktree) && !knownProjectKeys.has(mainWorktreeKey)) {
        setDirectoryServerId(mainWorktree, serverId);
        toRegister.push({ path: mainWorktree, serverId });
        knownProjectKeys.add(mainWorktreeKey);
      }

      // Populate worktree metadata directly for sandbox paths — do NOT register
      // them as independent projects. This eliminates the flash where worktrees
      // temporarily appear as top-level folders before discoverWorktrees completes.
      for (const sandboxPath of sandboxes) {
        listedDirectoryCount += 1;
        const sandboxKey = getRemoteProjectDiscoveryKey(serverId, sandboxPath);
        if (knownProjectKeys.has(sandboxKey)) continue;
        setDirectoryServerId(sandboxPath, serverId);
        knownProjectKeys.add(sandboxKey);

        const key = mainWorktree
          ? getProjectWorktreeKey(mainWorktree, serverId)
          : getProjectWorktreeKey(sandboxPath, serverId);
        const existingWT = worktreesByProject.get(key)
          ?? getWorktreesForProject(currentByProject, mainWorktree ?? sandboxPath, serverId);
        const wtMeta: WorktreeMetadata = {
          path: sandboxPath,
          projectDirectory: mainWorktree ?? sandboxPath,
          serverId,
          branch: '',
          label: sandboxPath.split('/').pop() || sandboxPath,
        };
        worktreesByProject.set(key, dedupeWorktreesByPath([...existingWT, wtMeta], serverId));
      }
    }

    if (listedDirectoryCount === 0) {
      scheduleDiscoveryRetry(serverId);
      return;
    }

    // Mark probed only on SUCCESS — failure must retry
    probedServers.current?.add(serverId);

    // Register main-project entries deferred (existing behaviour).
    for (const entry of toRegister) {
      setTimeout(() => { ensureRemoteProject(entry.path, entry.serverId); }, 0);
    }

    // Write worktree metadata directly to the store so sidebar grouping uses it
    // immediately — no waiting for the separate discoverWorktrees effect.
    if (worktreesByProject.size > 0) {
      const merged = new Map(currentByProject);
      for (const [key, wts] of worktreesByProject) {
        merged.set(key, dedupeWorktreesByPath(wts, serverId));
      }
      useSessionUIStore.setState({ availableWorktreesByProject: merged });
    }
  } catch {
    scheduleDiscoveryRetry(serverId);
    // Transient — retry on next discover cycle
  } finally {
    inFlightServers.current?.delete(serverId);
  }
}

async function fetchRemoteProjectList(
  connection: ServerConnection,
): Promise<unknown[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (connection.config.authToken) {
    headers.Authorization = `Bearer ${connection.config.authToken}`;
  }

  const response = await fetch(
    resolveApiUrl('/api/project', connection.config.baseUrl),
    {
      headers,
      signal: AbortSignal.timeout(REMOTE_PROJECT_LIST_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`project.list failed (${response.status})`);
  }

  const data = await response.json().catch(() => null);
  return Array.isArray(data) ? data : [];
}
