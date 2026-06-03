import React from "react";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { SyncProvider } from "./sync-context";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { useSessionUIStore } from "./session-ui-store";
import { useRemoteInstancesStore } from "@/stores/useRemoteInstancesStore";
import { isTauriShell, isWebRuntime } from "@/lib/desktop";
import { buildRemoteBootstrapDirectoryMap } from "./remote-bootstrap-directories";

type AdditionalServer = {
  id: string;
  sdk: OpencodeClient;
  baseUrl: string;
};

export function MultiServerSyncLayer() {
  const servers = useServerList();
  const projects = useProjectsStore((s) => s.projects);
  const availableWorktreesByProject = useSessionUIStore((s) => s.availableWorktreesByProject);
  const remoteInstancesInitialized = useRemoteInstancesStore((s) => s.initialized);
  const remoteInstancesLoading = useRemoteInstancesStore((s) => s.loading);
  const loadRemoteInstances = useRemoteInstancesStore((s) => s.loadInstances);

  React.useEffect(() => {
    if (!isWebRuntime() && !isTauriShell()) return;
    if (remoteInstancesInitialized || remoteInstancesLoading) return;
    void loadRemoteInstances();
  }, [loadRemoteInstances, remoteInstancesInitialized, remoteInstancesLoading]);

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
            remoteDirectories={remoteDirectories}
          >
            <React.Fragment />
          </SyncProvider>
        );
      })}
    </>
  );
}

function useServerList() {
  const [servers, setServers] = React.useState<AdditionalServer[]>(loadAdditionalServers);
  const remoteHealthSignature = useRemoteInstancesStore((s) => (
    Object.values(s.statuses)
      .map((status) => `${status.id}:${status.phase}:${status.healthy === true ? 1 : 0}:${status.url ?? ""}`)
      .sort()
      .join("|")
  ));

  React.useEffect(() => {
    const id = setInterval(() => setServers(loadAdditionalServers()), 5000);
    return () => clearInterval(id);
  }, []);

  React.useEffect(() => {
    const update = () => setServers(loadAdditionalServers());
    update();
    const unsubs = serverRegistry
      .getAll()
      .filter((connection) => connection.config.id !== DEFAULT_SERVER_ID)
      .map((connection) => serverRegistry.onHealthChange(connection.config.id, update));
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [remoteHealthSignature]);

  return servers;
}

function loadAdditionalServers(): AdditionalServer[] {
  return serverRegistry
    .getAll()
    .filter((c) => c.config.id !== DEFAULT_SERVER_ID && c.healthStatus === "healthy")
    .map((c) => ({ id: c.config.id, sdk: c.client, baseUrl: c.config.sseUrl || c.config.baseUrl }));
}
