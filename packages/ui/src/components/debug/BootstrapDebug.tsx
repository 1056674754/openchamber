import React from "react";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { getAllSyncStores } from "@/sync/multi-server-registry";
import { useActiveServerId } from "@/hooks/useActiveServerId";

export function BootstrapDebug() {
  const [visible, setVisible] = React.useState(true);
  const activeServerId = useActiveServerId();
  const projects = useProjectsStore((s) => s.projects);

  const [, forceUpdate] = React.useState(0);
  const servers = serverRegistry.getAll();
  const syncStores = getAllSyncStores();

  React.useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;

  const remoteProjects = projects.filter((p) => p.serverId && p.serverId !== DEFAULT_SERVER_ID);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        background: "rgba(0,0,0,0.85)",
        color: "#0f0",
        fontFamily: "monospace",
        fontSize: 11,
        padding: 8,
        borderRadius: 4,
        maxWidth: 420,
        maxHeight: 300,
        overflow: "auto",
        whiteSpace: "pre-wrap",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <strong>🔧 Bootstrap Debug</strong>
        <button onClick={() => setVisible(false)} style={{ color: "#f00", cursor: "pointer", background: "none", border: "none", fontSize: 14 }}>✕</button>
      </div>
      <div>activeServerId: {activeServerId}</div>
      <div>serverRegistry: {servers.length} [{servers.map((s) => `${s.config.id.slice(0,12)} url=${s.config.baseUrl.slice(-25)}`).join(" | ")}]</div>
      <div>syncStores: {syncStores.length} [{syncStores.map((e) => `${e.serverId} (stores=${e.childStores.children.size})`).join(", ")}]</div>
      <div>remoteProjects (with serverId): {remoteProjects.length}</div>
      {remoteProjects.map((p) => (
        <div key={p.id}>  {p.serverId}: {p.path}</div>
      ))}
      {syncStores.map((entry) => (
        <div key={entry.serverId}>
          --- {entry.serverId} ---
          {Array.from(entry.childStores.children.entries()).map(([dir, store]) => {
            const s = store.getState();
            return (
              <div key={dir}>  dir="{dir}" status={s.status} sessions={s.session.length} messages={Object.keys(s.message || {}).length}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
