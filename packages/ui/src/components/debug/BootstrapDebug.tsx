import React from "react";
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { useProjectsStore } from "@/stores/useProjectsStore";
import { useSessionUIStore } from "@/sync/session-ui-store";
import { getAllSyncStores } from "@/sync/multi-server-registry";
import { useActiveServerId } from "@/hooks/useActiveServerId";
import { useRemoteInstancesStore } from "@/stores/useRemoteInstancesStore";

const normalizePath = (value: string): string => {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || "/";
};

const compact = (value: string, max = 64): string => {
  if (value.length <= max) return value;
  return `${value.slice(0, 24)}...${value.slice(-28)}`;
};

const formatAge = (timestamp: number | null): string => {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return `${seconds}s`;
};

export function BootstrapDebug() {
  const [visible, setVisible] = React.useState(true);
  const activeServerId = useActiveServerId();
  const currentSessionId = useSessionUIStore((s) => s.currentSessionId);
  const projects = useProjectsStore((s) => s.projects);
  const remoteStatuses = useRemoteInstancesStore((s) => s.statuses);

  const [, forceUpdate] = React.useState(0);
  const servers = serverRegistry.getAll();
  const syncStores = getAllSyncStores();

  React.useEffect(() => {
    const id = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!visible) return null;

  const remoteProjects = projects.filter((p) => p.serverId && p.serverId !== DEFAULT_SERVER_ID);
  const healthyServerIds = new Set(
    servers
      .filter((server) => server.config.id !== DEFAULT_SERVER_ID && server.healthStatus === "healthy")
      .map((server) => server.config.id),
  );
  const remoteDirectoryMap = new Map<string, string[]>();
  for (const project of remoteProjects) {
    if (!project.serverId || !healthyServerIds.has(project.serverId)) continue;
    const path = normalizePath(project.path);
    if (path === "/") continue;
    const existing = remoteDirectoryMap.get(project.serverId) ?? [];
    if (!existing.includes(path)) {
      existing.push(path);
    }
    remoteDirectoryMap.set(project.serverId, existing);
  }

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
      <div>currentSessionId: {currentSessionId ?? "(none)"}</div>
      <div>serverRegistry: {servers.length}</div>
      {servers.map((s) => (
        <div key={s.config.id}>
          {"  "}
          {s.config.id}: health={s.healthStatus ?? "null"} age={formatAge(s.lastHealthCheckAt)} url={compact(s.config.baseUrl)}
        </div>
      ))}
      <div>remoteStatuses: {Object.keys(remoteStatuses).length}</div>
      {Object.values(remoteStatuses).map((status) => (
        <div key={status.id}>
          {"  "}
          {status.id}: phase={status.phase} healthy={String(status.healthy)} url={status.url ? compact(status.url) : "(none)"}
        </div>
      ))}
      <div>remoteDirectories: {remoteDirectoryMap.size}</div>
      {Array.from(remoteDirectoryMap.entries()).map(([serverId, dirs]) => (
        <div key={serverId}>
          {"  "}
          {serverId}: {dirs.length} [{dirs.map((dir) => compact(dir, 44)).join(", ")}]
        </div>
      ))}
      <div>syncStores: {syncStores.length} [{syncStores.map((e) => `${e.serverId} (stores=${e.childStores.children.size})`).join(", ")}]</div>
      <div>remoteProjects (with serverId): {remoteProjects.length}</div>
      {remoteProjects.map((p) => (
        <div key={p.id}>  {p.serverId}: {p.path} unavailable={String(p.unavailable === true)}</div>
      ))}
      {syncStores.map((entry) => (
        <div key={entry.serverId}>
          --- {entry.serverId} ---
          {Array.from(entry.childStores.children.entries()).map(([dir, store]) => {
            const s = store.getState();
            const activeSession = currentSessionId ? s.session.find((ss: { id?: string }) => ss.id === currentSessionId) : undefined;
            const activeStatus = currentSessionId ? s.session_status?.[currentSessionId] : undefined;
            return (
              <div key={dir}>  dir="{dir}" status={s.status} sessions={s.session.length} messages={Object.keys(s.message || {}).length}{activeSession ? ` [active: status=${JSON.stringify(activeStatus)}]` : ""}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
