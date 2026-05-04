import React from "react";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { SyncProvider } from "./sync-context";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";

type AdditionalServer = {
  id: string;
  sdk: OpencodeClient;
  baseUrl: string;
};

export function MultiServerSyncLayer() {
  const [servers, setServers] = React.useState<AdditionalServer[]>(loadAdditionalServers);

  React.useEffect(() => {
    const id = setInterval(() => setServers(loadAdditionalServers()), 5000);
    return () => clearInterval(id);
  }, []);

  if (servers.length === 0) return null;

  return (
    <>
      {servers.map((s) => (
        <SyncProvider key={s.id} sdk={s.sdk} directory="" serverId={s.id} baseUrl={s.baseUrl}>
          <React.Fragment />
        </SyncProvider>
      ))}
    </>
  );
}

function loadAdditionalServers(): AdditionalServer[] {
  return serverRegistry
    .getAll()
    .filter((c) => c.config.id !== DEFAULT_SERVER_ID)
    .map((c) => ({ id: c.config.id, sdk: c.client, baseUrl: c.config.baseUrl }));
}
