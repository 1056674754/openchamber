import type { Session } from "@opencode-ai/sdk/v2"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"
import { formatSdkError } from "./sdk-error"

export const SESSION_LIST_BOOTSTRAP_TIMEOUT_MS = 8_000
export const SESSION_LIST_BOOTSTRAP_LIMIT = 200
export const REMOTE_SESSION_LIST_TIMEOUT_MS = SESSION_LIST_BOOTSTRAP_TIMEOUT_MS
export const REMOTE_SESSION_LIST_LIMIT = SESSION_LIST_BOOTSTRAP_LIMIT

export type ListSessionsForBootstrapOptions = {
  roots?: boolean
}

export const buildRemoteSessionListUrl = (
  baseUrl: string,
  directory: string,
  options?: ListSessionsForBootstrapOptions,
): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  const params = new URLSearchParams({
    directory,
    roots: options?.roots === true ? "true" : "false",
    limit: String(REMOTE_SESSION_LIST_LIMIT),
  })
  return `${normalizedBaseUrl}/session?${params.toString()}`
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

const createRemoteListSignal = (external?: AbortSignal) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SESSION_LIST_BOOTSTRAP_TIMEOUT_MS)
  const abort = () => controller.abort()
  external?.addEventListener("abort", abort, { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      external?.removeEventListener("abort", abort)
    },
  }
}

export async function listSessionsForBootstrap(
  sdkClient: OpencodeClient,
  serverId: string,
  directory: string,
  signal?: AbortSignal,
  options?: ListSessionsForBootstrapOptions,
): Promise<Session[]> {
  const roots = options?.roots === true
  const connection = serverId !== DEFAULT_SERVER_ID ? serverRegistry.get(serverId) : undefined
  if (connection) {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (connection.config.authToken) {
      headers.Authorization = `Bearer ${connection.config.authToken}`
    }
    const request = createRemoteListSignal(signal)
    try {
      const response = await fetch(buildRemoteSessionListUrl(connection.config.baseUrl, directory, { roots }), {
        headers,
        signal: request.signal,
      })
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
          ? (body as { code: string }).code
          : undefined
        const err = new Error(`session.list failed (${response.status})${code ? `: ${code}` : ""}`)
        const detail = err as Error & { status?: number; code?: string; retryAfterMs?: number }
        detail.status = response.status
        if (code) detail.code = code
        const retryAfterMs = readRetryAfterMs(response, body)
        if (retryAfterMs !== undefined) detail.retryAfterMs = retryAfterMs
        throw err
      }
      const data: unknown = await response.json()
      if (!Array.isArray(data)) {
        const err = new Error("session.list returned invalid data")
        ;(err as Error & { status?: number }).status = 503
        throw err
      }
      return data.filter((item): item is Session => Boolean(item?.id))
    } finally {
      request.cleanup()
    }
  }

  const result = await sdkClient.session.list({
    directory,
    roots,
    limit: SESSION_LIST_BOOTSTRAP_LIMIT,
  })
  const rawError = (result as { error?: unknown }).error
  if (rawError) {
    const response = (result as { response?: { status?: number } }).response
    const status = response?.status
    const message = formatSdkError(rawError)
    const wrapped = new Error(`session.list failed${status ? ` (${status})` : ""}: ${message}`)
    if (status !== undefined) {
      ;(wrapped as Error & { status?: number }).status = status
    }
    throw wrapped
  }
  if (result.data === undefined) {
    const wrapped = new Error("session.list returned no data")
    ;(wrapped as Error & { status?: number }).status = 503
    throw wrapped
  }
  return result.data.filter((item): item is Session => Boolean(item?.id))
}
