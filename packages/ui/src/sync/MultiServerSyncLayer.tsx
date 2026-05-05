import React from "react";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { SyncProvider } from "./sync-context";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";

type AdditionalServer = {
  id: string;
  sdk: OpencodeClient;
  baseUrl: string;
};

export function MultiServerSyncLayer() {
  const servers = useServerList();
  const projects = useProjectsStore((s) => s.projects);

  const serverDirMap = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of projects) {
      if (p.serverId && p.serverId !== DEFAULT_SERVER_ID) {
        const dirs = map.get(p.serverId) || [];
        dirs.push(p.path);
        map.set(p.serverId, dirs);
      }
    }
    return map;
  }, [projects]);

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

  React.useEffect(() => {
    const id = setInterval(() => setServers(loadAdditionalServers()), 5000);
    return () => clearInterval(id);
  }, []);

  return servers;
}

function loadAdditionalServers(): AdditionalServer[] {
  return serverRegistry
    .getAll()
    .filter((c) => c.config.id !== DEFAULT_SERVER_ID)
    .map((c) => ({ id: c.config.id, sdk: c.client, baseUrl: c.config.sseUrl || c.config.baseUrl }));
}
