import React from "react";
import { SyncProvider } from "./sync-context";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { useSessionUIStore } from "./session-ui-store";
import { useRemoteInstancesStore } from "@/stores/useRemoteInstancesStore";
import { hasDesktopInvoke, isWebRuntime } from "@/lib/desktop";
import { buildRemoteBootstrapDirectoryMap } from "./remote-bootstrap-directories";
import { useActiveServerId } from "@/hooks/useActiveServerId";
import { getOrRegisterRemoteConnection } from "./session-routing";
import {
  areLiveSyncServerListsEquivalent,
  resolveLiveSyncServers,
  type LiveSyncServer,
} from "./live-sync-servers";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";

/**
 * Loads host-aggregated remote instances for list UI, and mounts at most one
 * extra SyncProvider for the active remote. Healthy remotes in the list must
 * not each get a SyncProvider (client fanout).
 */
export function MultiServerSyncLayer() {
  const activeServerId = useActiveServerId();
  const servers = useLiveSyncServerList(activeServerId);
  const projects = useProjectsStore((s) => s.projects);
  const availableWorktreesByProject = useSessionUIStore((s) => s.availableWorktreesByProject);
  const remoteInstancesInitialized = useRemoteInstancesStore((s) => s.initialized);
  const remoteInstancesLoading = useRemoteInstancesStore((s) => s.loading);
  const loadRemoteInstances = useRemoteInstancesStore((s) => s.loadInstances);

  React.useEffect(() => {
    if (!isWebRuntime() && !hasDesktopInvoke()) return;
    if (remoteInstancesInitialized || remoteInstancesLoading) return;
    void loadRemoteInstances();
  }, [loadRemoteInstances, remoteInstancesInitialized, remoteInstancesLoading]);

  // Ensure the active remote is registered for live sync without registering the whole list.
  React.useEffect(() => {
    if (!activeServerId || activeServerId === DEFAULT_SERVER_ID) return;
    const instance = useRemoteInstancesStore.getState().instances.find((entry) => entry.id === activeServerId);
    getOrRegisterRemoteConnection(activeServerId, instance?.label);
  }, [activeServerId]);

  const healthyServerIds = React.useMemo(() => new Set(servers.map((server) => server.id)), [servers]);

  const serverDirMap = React.useMemo(
    () => buildRemoteBootstrapDirectoryMap(projects, availableWorktreesByProject, healthyServerIds),
    [availableWorktreesByProject, healthyServerIds, projects],
  );

  if (servers.length === 0) return null;

  return (
    <>
      {servers.map((s) => {
        const remoteDirectories = serverDirMap.get(s.id) || [];
        return (
          <SyncProvider
            key={s.id}
            sdk={s.sdk}
            directory=""
            serverId={s.id}
            baseUrl={s.baseUrl}
            eventSource="bus"
            remoteDirectories={remoteDirectories}
          >
            <React.Fragment />
          </SyncProvider>
        );
      })}
    </>
  );
}

function useLiveSyncServerList(activeServerId: string): LiveSyncServer[] {
  const [servers, setServers] = React.useState<LiveSyncServer[]>(() => resolveLiveSyncServers(activeServerId));
  const remoteHealthSignature = useRemoteInstancesStore((s) => (
    Object.values(s.statuses)
      .map((status) => `${status.id}:${status.phase}:${status.healthy === true ? 1 : 0}:${status.url ?? ""}`)
      .sort()
      .join("|")
  ));

  React.useEffect(() => {
    const refresh = () => {
      setServers((current) => {
        const next = resolveLiveSyncServers(activeServerId);
        return areLiveSyncServerListsEquivalent(current, next) ? current : next;
      });
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [activeServerId, remoteHealthSignature]);

  return servers;
}
