import { useEffect, useRef, type MutableRefObject } from "react";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { setDirectoryServerId } from "./session-actions";
import { resolveApiUrl } from "@/lib/api/serverUrl";

const AVAILABLE_PROJECT_PROBE_TTL_MS = 30_000;
const UNAVAILABLE_PROJECT_RETRY_MS = 5_000;

type AvailabilityProbeRecord = {
  inFlight: boolean;
  lastCheckedAt: number;
  unavailable: boolean;
};

const normalizeRemoteProjectPath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
};

const shouldSkipRemoteProjectPath = (value: string): boolean => {
  return normalizeRemoteProjectPath(value) === "/";
};

export function RemoteProjectDiscovery() {
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const knownDirs = useRef(new Set<string>());
  const probedServers = useRef(new Set<string>()); // [OPENCHAMBER-FORK] track worktree discovery per server
  const availabilityProbes = useRef(new Map<string, AvailabilityProbeRecord>());
  const pendingProjects = useRef(new Map<string, { path: string; serverId: string }>());
  const flushTimer = useRef<number | null>(null);

  useEffect(() => {
    const storeUnsubs = new Map<string, () => void>();
    const healthUnsubs = new Map<string, () => void>();
    const pendingProjectQueue = pendingProjects.current;

    const queueRemoteProject = (path: string, serverId: string) => {
      if (shouldSkipRemoteProjectPath(path)) return;
      const key = `${serverId}:${path}`;
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
          const key = `${entry.serverId}:${directory}`;
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
            const key = `${entry.serverId}:${dir}`;
            if (knownDirs.current.has(key)) continue;
            knownDirs.current.add(key);
            setDirectoryServerId(dir, entry.serverId);
            queueRemoteProject(dir, entry.serverId);
          }
        }

        probeRemoteProjectAvailability(entry.serverId, store.projects, availabilityProbes);
        // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
        // Probe remote sessions to discover worktree directories not yet registered as projects.
        discoverWorktreeDirectories(entry.serverId, store.projects, queueRemoteProject, probedServers);
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
      pendingProjectQueue.clear();
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
) {
  const connection = serverRegistry.get(serverId);
  if (!connection || connection.healthStatus !== 'healthy') return;
  if (probedServers.current?.has(serverId)) return;

  const client = connection.client;
  const knownPaths = new Set(projects.map((p) => p.path));

  try {
    const result = await client.project.list();
    const data = (result as { data?: unknown[] }).data;
    if (!Array.isArray(data)) return;
    const toRegister: Array<{ path: string; serverId: string }> = [];
    for (const p of data) {
      if (typeof p !== "object" || p === null) continue;
      if ((p as { id?: string }).id === "global") continue;
      // Check BOTH worktree (main path) and sandboxes (worktree paths)
      const dirs = [
        (p as { worktree?: string }).worktree,
        ...((p as { sandboxes?: string[] }).sandboxes ?? []),
      ].filter((directory): directory is string => Boolean(directory) && !shouldSkipRemoteProjectPath(directory as string));
      for (const d of dirs) {
        if (knownPaths.has(d)) continue;
        // [OPENCHAMBER-FORK] Cache immediately — resolveSdkForDirectory may be called
        // before the deferred ensureRemoteProject registers this as a project
        setDirectoryServerId(d, serverId);
        toRegister.push({ path: d, serverId });
        knownPaths.add(d);
      }
    }
    // Mark probed only on SUCCESS — failure must retry
    probedServers.current?.add(serverId);
    // Defer project registration to avoid triggering
    // useGitRepoStatusMap / useSyncExternalStore snapshot instability in SessionSidebar
    for (const entry of toRegister) {
      setTimeout(() => { ensureRemoteProject(entry.path, entry.serverId); }, 0);
    }
  } catch {
    // Transient — retry on next discover cycle
  }
}
