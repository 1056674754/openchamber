import "@/lib/remote-instances/rpcFetch";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";

const DEFAULT_HEALTH_PROBE_TTL_MS = 5_000;
const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 3_000;
const SESSION_SERVER_INDEX_DEBUG_LIMIT = 500;

export interface ServerConfig {
  id: string;
  label: string;
  baseUrl: string;
  sseUrl?: string;
  healthUrl?: string;
  healthMethod?: "GET" | "POST";
  authToken?: string;
}

export interface ServerConnection {
  readonly config: ServerConfig;
  readonly client: OpencodeClient;
  healthStatus: "healthy" | "unhealthy" | "connecting" | null;
  lastHealthCheckAt: number | null;
}

export interface SessionServerIndexDebugEntry {
  at: string;
  sessionId: string;
  previous?: string;
  next?: string;
  stack?: string;
}

type ProbeHealthOptions = {
  force?: boolean;
  timeoutMs?: number;
};

export const DEFAULT_SERVER_ID = "default";

export class ServerRegistry {
  private connections: Map<string, ServerConnection> = new Map();
  private sessionServerIndex: Map<string, string> = new Map();
  private healthPollTimer: ReturnType<typeof setInterval> | null = null;
  private healthListeners: Map<string, Set<(status: ServerConnection["healthStatus"]) => void>> = new Map();
  private sessionServerListeners: Map<string, Set<() => void>> = new Map();
  private healthProbeInFlight: Map<string, Promise<boolean>> = new Map();
  private lastHealthProbeAt: Map<string, number> = new Map();
  private sessionServerIndexDebugEntries: SessionServerIndexDebugEntry[] = [];

  register(config: ServerConfig): ServerConnection {
    const existing = this.connections.get(config.id);
    if (existing && existing.config.baseUrl === config.baseUrl) {
      existing.config.label = config.label;
      existing.config.sseUrl = config.sseUrl;
      existing.config.healthUrl = config.healthUrl;
      existing.config.healthMethod = config.healthMethod;
      if (config.authToken !== undefined) {
        existing.config.authToken = config.authToken;
      }
      return existing;
    }

    if (existing) {
      this.connections.delete(config.id);
    }

    const connection: ServerConnection = {
      config: { ...config },
      client: createOpencodeClient({ baseUrl: config.baseUrl }),
      healthStatus: null,
      lastHealthCheckAt: null,
    };
    this.connections.set(config.id, connection);
    return connection;
  }

  unregister(serverId: string): boolean {
    if (serverId === DEFAULT_SERVER_ID) return false;
    const deleted = this.connections.delete(serverId);
    if (deleted) {
      this.healthProbeInFlight.delete(serverId);
      this.lastHealthProbeAt.delete(serverId);
      this.notifyHealthListeners(serverId);
    }
    return deleted;
  }

  get(serverId: string): ServerConnection | undefined {
    return this.connections.get(serverId);
  }

  getDefault(): ServerConnection | undefined {
    return this.connections.get(DEFAULT_SERVER_ID);
  }

  getAll(): ReadonlyArray<ServerConnection> {
    return Array.from(this.connections.values());
  }

  has(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  indexSession(sessionId: string, serverId: string): void {
    const previous = this.sessionServerIndex.get(sessionId);
    if (previous === serverId) {
      return;
    }
    this.recordSessionServerIndexDebug(sessionId, previous, serverId);
    this.sessionServerIndex.set(sessionId, serverId);
    this.notifySessionServerListeners(sessionId);
  }

  getServerForSession(sessionId: string): string | undefined {
    return this.sessionServerIndex.get(sessionId);
  }

  getSessionServerIndexSnapshot(): Array<{ sessionId: string; serverId: string }> {
    return Array.from(this.sessionServerIndex.entries(), ([sessionId, serverId]) => ({ sessionId, serverId }));
  }

  getSessionServerIndexDebugEntries(options?: { sessionId?: string; limit?: number }): SessionServerIndexDebugEntry[] {
    const sessionId = options?.sessionId;
    const limit = Math.max(1, Math.min(options?.limit ?? SESSION_SERVER_INDEX_DEBUG_LIMIT, SESSION_SERVER_INDEX_DEBUG_LIMIT));
    const entries = sessionId
      ? this.sessionServerIndexDebugEntries.filter((entry) => entry.sessionId === sessionId)
      : this.sessionServerIndexDebugEntries;
    return entries.slice(-limit);
  }

  clearSessionServerIndexDebugEntries(): void {
    this.sessionServerIndexDebugEntries = [];
  }

  getClientForSession(sessionId: string): ServerConnection | undefined {
    const serverId = this.sessionServerIndex.get(sessionId);
    if (!serverId) return undefined;
    return this.connections.get(serverId);
  }

  setHealthStatus(serverId: string, status: ServerConnection["healthStatus"]): void {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    const previous = connection.healthStatus;
    connection.healthStatus = status;
    if (status === "healthy") {
      connection.lastHealthCheckAt = Date.now();
    }
    if (previous !== status) {
      this.notifyHealthListeners(serverId);
    }
  }

  forgetSession(sessionId: string): void {
    const previous = this.sessionServerIndex.get(sessionId);
    const deleted = this.sessionServerIndex.delete(sessionId);
    if (deleted) {
      this.recordSessionServerIndexDebug(sessionId, previous, undefined);
      this.notifySessionServerListeners(sessionId);
    }
  }

  onSessionServerChange(sessionId: string, callback: () => void): () => void {
    let listeners = this.sessionServerListeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.sessionServerListeners.set(sessionId, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
      if (listeners && listeners.size === 0) {
        this.sessionServerListeners.delete(sessionId);
      }
    };
  }

  async probeHealth(serverId: string, options: ProbeHealthOptions = {}): Promise<boolean> {
    const connection = this.connections.get(serverId);
    if (!connection) return false;

    const inFlight = this.healthProbeInFlight.get(serverId);
    if (inFlight) return inFlight;

    const lastProbeAt = this.lastHealthProbeAt.get(serverId) ?? 0;
    if (!options.force && lastProbeAt > 0 && Date.now() - lastProbeAt < DEFAULT_HEALTH_PROBE_TTL_MS) {
      return connection.healthStatus === "healthy";
    }

    const probe = this.runHealthProbe(connection, options).finally(() => {
      this.healthProbeInFlight.delete(serverId);
    });
    this.healthProbeInFlight.set(serverId, probe);
    return probe;
  }

  private async runHealthProbe(connection: ServerConnection, options: ProbeHealthOptions): Promise<boolean> {
    const serverId = connection.config.id;
    this.lastHealthProbeAt.set(serverId, Date.now());

    if (connection.healthStatus !== "healthy") {
      this.setHealthStatus(connection.config.id, "connecting");
    }

    try {
      const baseUrl = connection.config.baseUrl.replace(/\/+$/, "");
      let healthUrl = connection.config.healthUrl?.trim() || "";
      if (!healthUrl && baseUrl === "/api") {
        healthUrl = "/health";
      } else if (!healthUrl && baseUrl.endsWith("/api")) {
        healthUrl = `${baseUrl.slice(0, -4)}/health`;
      } else if (!healthUrl) {
        healthUrl = `${baseUrl}/health`;
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (connection.config.authToken) {
        headers["Authorization"] = `Bearer ${connection.config.authToken}`;
      }

      const method = connection.config.healthMethod ?? "GET";
      const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1_000, Math.round(options.timeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS))
        : DEFAULT_HEALTH_PROBE_TIMEOUT_MS;
      const requestInit: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      };
      if (method === "POST") {
        headers["Content-Type"] = "application/json";
        requestInit.body = JSON.stringify({ timeoutSec: Math.max(1, Math.ceil(timeoutMs / 1000)) });
      }

      const response = await fetch(healthUrl, {
        ...requestInit,
      });
      if (!response.ok) {
        this.setHealthStatus(serverId, "unhealthy");
        return false;
      }

      const data = await response.json();
      if (data?.isOpenCodeReady === false || data?.healthy === false || data?.connected === false) {
        this.setHealthStatus(serverId, "unhealthy");
        return false;
      }

      this.setHealthStatus(serverId, "healthy");
      return true;
    } catch {
      this.setHealthStatus(serverId, "unhealthy");
      return false;
    }
  }

  getServerLabel(serverId: string): string {
    return this.connections.get(serverId)?.config.label ?? serverId;
  }

  onHealthChange(serverId: string, callback: (status: ServerConnection["healthStatus"]) => void): () => void {
    let listeners = this.healthListeners.get(serverId);
    if (!listeners) {
      listeners = new Set();
      this.healthListeners.set(serverId, listeners);
    }
    listeners.add(callback);
    return () => {
      listeners?.delete(callback);
      if (listeners && listeners.size === 0) {
        this.healthListeners.delete(serverId);
      }
    };
  }

  private notifyHealthListeners(serverId: string): void {
    const connection = this.connections.get(serverId);
    const listeners = this.healthListeners.get(serverId);
    if (listeners) {
      for (const cb of listeners) {
        cb(connection?.healthStatus ?? null);
      }
    }
  }

  private notifySessionServerListeners(sessionId: string): void {
    const listeners = this.sessionServerListeners.get(sessionId);
    if (!listeners) return;
    for (const cb of Array.from(listeners)) {
      cb();
    }
  }

  private recordSessionServerIndexDebug(sessionId: string, previous: string | undefined, next: string | undefined): void {
    const entry: SessionServerIndexDebugEntry = {
      at: new Date().toISOString(),
      sessionId,
      previous,
      next,
      stack: new Error("serverRegistry.indexSession trace").stack,
    };
    this.sessionServerIndexDebugEntries.push(entry);
    if (this.sessionServerIndexDebugEntries.length > SESSION_SERVER_INDEX_DEBUG_LIMIT) {
      this.sessionServerIndexDebugEntries.splice(0, this.sessionServerIndexDebugEntries.length - SESSION_SERVER_INDEX_DEBUG_LIMIT);
    }

    if (typeof window !== "undefined") {
      const enabled = window.localStorage?.getItem?.("openchamber_server_registry_debug") === "1";
      if (enabled) {
        console.debug("[openchamber:server-registry]", entry);
      }
    }
  }

  startHealthPolling(intervalMs = 30_000): void {
    if (this.healthPollTimer) return;
    const poll = () => {
      const ids = Array.from(this.connections.keys());
      for (const id of ids) {
        void this.probeHealth(id, { force: true });
      }
    };
    poll();
    this.healthPollTimer = setInterval(poll, intervalMs);
  }

  stopHealthPolling(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
  }
}

export const serverRegistry = new ServerRegistry();

if (typeof window !== "undefined") {
  window.__openchamberServerRegistryDebug = {
    enable: () => {
      window.localStorage.setItem("openchamber_server_registry_debug", "1");
    },
    disable: () => {
      window.localStorage.removeItem("openchamber_server_registry_debug");
    },
    enabled: () => window.localStorage.getItem("openchamber_server_registry_debug") === "1",
    clear: () => serverRegistry.clearSessionServerIndexDebugEntries(),
    index: () => serverRegistry.getSessionServerIndexSnapshot(),
    lookup: (sessionId: string) => serverRegistry.getServerForSession(sessionId),
    trace: (sessionId?: string, limit?: number) =>
      serverRegistry.getSessionServerIndexDebugEntries({ sessionId, limit }),
  };
}
