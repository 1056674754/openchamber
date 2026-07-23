import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

import { serverRegistry } from "@/lib/opencode/server-registry"
import { resolveApiUrl } from "@/lib/api/serverUrl"
import { retry } from "./retry"
import {
  KeyedRemoteReadCache,
  type RemoteReadScheduler,
  sharedRemoteReadScheduler,
} from "./remote-read-scheduler"

const REMOTE_STATUS_REQUEST_TIMEOUT_MS = 5_000

export type RemoteSessionStatusMap = Record<string, SessionStatus>

type RemoteSessionStatusReaderOptions = {
  scheduler: RemoteReadScheduler
  load: (serverId: string, directory: string) => Promise<RemoteSessionStatusMap>
}

const readRetryAfterMs = (response: Response, body: unknown): number | undefined => {
  if (body && typeof body === "object") {
    const value = (body as { retryAfterMs?: unknown }).retryAfterMs
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  }
  const header = response.headers.get("retry-after")
  if (!header) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

const isSessionStatus = (value: unknown): value is SessionStatus => {
  if (!value || typeof value !== "object" || !("type" in value)) return false
  if (value.type === "idle" || value.type === "busy") return true
  return value.type === "retry"
    && "attempt" in value
    && typeof value.attempt === "number"
    && "message" in value
    && typeof value.message === "string"
    && "next" in value
    && typeof value.next === "number"
}

const loadRemoteSessionStatuses = async (
  serverId: string,
  directory: string,
): Promise<RemoteSessionStatusMap> => {
  const connection = serverRegistry.get(serverId)
  if (!connection || connection.healthStatus !== "healthy") {
    throw new Error(`Remote server ${serverId} is not healthy`)
  }

  const url = resolveApiUrl("/session/status", connection.config.baseUrl)
  const params = new URLSearchParams({ directory })
  const headers: Record<string, string> = { Accept: "application/json" }
  if (connection.config.authToken) headers.Authorization = `Bearer ${connection.config.authToken}`
  const response = await fetch(`${url}?${params.toString()}`, {
    headers,
    signal: AbortSignal.timeout(REMOTE_STATUS_REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? (body as { code: string }).code
      : undefined
    const error = new Error(`session.status failed (${response.status})${code ? `: ${code}` : ""}`)
    const detail = error as Error & { status?: number; code?: string; retryAfterMs?: number }
    detail.status = response.status
    if (code) detail.code = code
    const retryAfterMs = readRetryAfterMs(response, body)
    if (retryAfterMs !== undefined) detail.retryAfterMs = retryAfterMs
    throw error
  }

  const body: unknown = await response.json()
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("session.status returned invalid data")
    ;(error as Error & { status?: number }).status = 503
    throw error
  }

  const statuses: RemoteSessionStatusMap = {}
  for (const [sessionId, status] of Object.entries(body)) {
    if (isSessionStatus(status)) statuses[sessionId] = status
  }
  return statuses
}

export const createRemoteSessionStatusReader = (options: RemoteSessionStatusReaderOptions) => {
  const cache = new KeyedRemoteReadCache<RemoteSessionStatusMap>(options.scheduler)
  return {
    read: (serverId: string, directory: string) => cache.schedule(
      serverId,
      `session.status:${directory}`,
      () => options.load(serverId, directory),
    ),
  }
}

const remoteSessionStatusReader = createRemoteSessionStatusReader({
  scheduler: sharedRemoteReadScheduler,
  load: (serverId, directory) => retry(
    () => loadRemoteSessionStatuses(serverId, directory),
    {
      attempts: 3,
      delay: 500,
      factor: 2,
      maxDelay: 15_000,
      jitter: 0.25,
    },
  ),
})

export const readRemoteSessionStatuses = (
  serverId: string,
  directory: string,
): Promise<RemoteSessionStatusMap> => remoteSessionStatusReader.read(serverId, directory)
