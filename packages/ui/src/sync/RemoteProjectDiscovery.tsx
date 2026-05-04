import { useEffect, useRef } from "react";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";

export function RemoteProjectDiscovery() {
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const knownDirs = useRef(new Set<string>());

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

    return () => {
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
