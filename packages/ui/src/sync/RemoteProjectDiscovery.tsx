import { useEffect, useRef } from "react";
import { getAllSyncStores, subscribeSyncStoresRegistry } from "./multi-server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";

export function RemoteProjectDiscovery() {
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const knownDirs = useRef(new Set<string>());

  useEffect(() => {
    const discover = () => {
      const entries = getAllSyncStores();
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
