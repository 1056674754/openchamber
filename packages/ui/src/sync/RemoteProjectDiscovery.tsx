import { useEffect, useRef, type MutableRefObject } from "react";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { setDirectoryServerId } from "./session-actions";

export function RemoteProjectDiscovery() {
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const knownDirs = useRef(new Set<string>());
  const probedServers = useRef(new Set<string>()); // [OPENCHAMBER-FORK] track worktree discovery per server

  useEffect(() => {
    const discover = () => {
      const entries = getAllSyncStores();
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
            ensureRemoteProject(dir, entry.serverId);
          }
        }

        probeRemoteProjectAvailability(entry.serverId, store.projects);
        // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
        // Probe remote sessions to discover worktree directories not yet registered as projects.
        discoverWorktreeDirectories(entry.serverId, store.projects, ensureRemoteProject, probedServers);
      }
    };

    discover();
    const unsubRegistry = subscribeSyncStoresRegistry(discover);

    const storeUnsubs: (() => void)[] = [];
    for (const entry of getAllSyncStores()) {
      for (const store of entry.childStores.children.values()) {
        storeUnsubs.push(store.subscribe(discover));
      }
    }

    // [OPENCHAMBER-FORK] 2025-05-18 v1.11.1-dev-merge
    // discoverWorktreeDirectories requires health==="healthy". If the first discover()
    // runs before the health probe completes, subscribe to health changes and re-scan
    // when the server becomes healthy. Event-driven, no polling, no interval loops.
    const healthUnsubs: (() => void)[] = [];
    for (const entry of getAllSyncStores()) {
      if (entry.serverId === DEFAULT_SERVER_ID) continue;
      if (probedServers.current?.has(entry.serverId)) continue;
      healthUnsubs.push(
        serverRegistry.onHealthChange(entry.serverId, (status) => {
          if (status === "healthy" && !probedServers.current?.has(entry.serverId)) {
            discover();
          }
        })
      );
    }

    return () => {
      for (const u of healthUnsubs) u();
      unsubRegistry();
      for (const u of storeUnsubs) u();
    };
  }, [ensureRemoteProject]);

  return null;
}

async function probeRemoteProjectAvailability(
  serverId: string,
  projects: ReadonlyArray<{ id: string; serverId?: string; path: string; unavailable?: boolean }>,
) {
  const connection = serverRegistry.get(serverId);
  if (!connection || connection.healthStatus !== 'healthy') return;

  const remoteProjects = projects.filter(
    (p) => p.serverId === serverId,
  );
  if (remoteProjects.length === 0) return;

  const baseUrl = connection.config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (connection.config.authToken) {
    headers['Authorization'] = `Bearer ${connection.config.authToken}`;
  }

  const markProjectAvailability = useProjectsStore.getState().markProjectAvailability;

  for (const project of remoteProjects) {
    try {
      const res = await fetch(
        `${baseUrl}/api/fs/list?path=${encodeURIComponent(project.path)}`,
        { headers, signal: AbortSignal.timeout(5000) },
      );
      const available = res.ok;
      if (available === !project.unavailable) continue;
      markProjectAvailability(
        project.id,
        available,
      );
    } catch {
      if (!project.unavailable) {
        markProjectAvailability(
          project.id,
          false,
        );
      }
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
      // Check BOTH worktree (main path) and sandboxes (worktree paths)
      const dirs = [
        (p as { worktree?: string }).worktree,
        ...((p as { sandboxes?: string[] }).sandboxes ?? []),
      ].filter(Boolean) as string[];
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
