import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2";

export interface ServerConfig {
  id: string;
  label: string;
  baseUrl: string;
  authToken?: string;
}

export interface ServerConnection {
  readonly config: ServerConfig;
  readonly client: OpencodeClient;
  healthStatus: "healthy" | "unhealthy" | "connecting" | null;
  lastHealthCheckAt: number | null;
}

export const DEFAULT_SERVER_ID = "default";

export class ServerRegistry {
  private connections: Map<string, ServerConnection> = new Map();
  private sessionServerIndex: Map<string, string> = new Map();

  register(config: ServerConfig): ServerConnection {
    const existing = this.connections.get(config.id);
    if (existing && existing.config.baseUrl === config.baseUrl) {
      existing.config.label = config.label;
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
    return this.connections.delete(serverId);
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
    this.sessionServerIndex.set(sessionId, serverId);
  }

  getServerForSession(sessionId: string): string | undefined {
    return this.sessionServerIndex.get(sessionId);
  }

  getClientForSession(sessionId: string): ServerConnection | undefined {
    const serverId = this.sessionServerIndex.get(sessionId);
    if (!serverId) return undefined;
    return this.connections.get(serverId);
  }

  forgetSession(sessionId: string): void {
    this.sessionServerIndex.delete(sessionId);
  }

  async probeHealth(serverId: string): Promise<boolean> {
    const connection = this.connections.get(serverId);
    if (!connection) return false;

    connection.healthStatus = "connecting";

    try {
      const baseUrl = connection.config.baseUrl.replace(/\/+$/, "");
      let healthUrl: string;
      if (baseUrl === "/api") {
        healthUrl = "/health";
      } else if (baseUrl.endsWith("/api")) {
        healthUrl = `${baseUrl.slice(0, -4)}/health`;
      } else {
        healthUrl = `${baseUrl}/health`;
      }

      const headers: Record<string, string> = { Accept: "application/json" };
      if (connection.config.authToken) {
        headers["Authorization"] = `Bearer ${connection.config.authToken}`;
      }

      const response = await fetch(healthUrl, { headers });
      if (!response.ok) {
        connection.healthStatus = "unhealthy";
        return false;
      }

      const data = await response.json();
      if (data?.isOpenCodeReady === false) {
        connection.healthStatus = "unhealthy";
        return false;
      }

      connection.healthStatus = "healthy";
      connection.lastHealthCheckAt = Date.now();
      return true;
    } catch {
      connection.healthStatus = "unhealthy";
      return false;
    }
  }

  getServerLabel(serverId: string): string {
    return this.connections.get(serverId)?.config.label ?? serverId;
  }
}

export const serverRegistry = new ServerRegistry();
