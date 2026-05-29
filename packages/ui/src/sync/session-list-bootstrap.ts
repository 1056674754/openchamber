import type { Session } from "@opencode-ai/sdk/v2"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"

export const REMOTE_SESSION_LIST_TIMEOUT_MS = 8_000
export const REMOTE_SESSION_LIST_LIMIT = 200

export const buildRemoteSessionListUrl = (baseUrl: string, directory: string): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  const params = new URLSearchParams({
    directory,
    roots: "false",
    limit: String(REMOTE_SESSION_LIST_LIMIT),
  })
  return `${normalizedBaseUrl}/session?${params.toString()}`
}

export async function listSessionsForBootstrap(
  sdkClient: OpencodeClient,
  serverId: string,
  directory: string,
): Promise<Session[]> {
  const connection = serverId !== DEFAULT_SERVER_ID ? serverRegistry.get(serverId) : undefined
  if (connection) {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (connection.config.authToken) {
      headers.Authorization = `Bearer ${connection.config.authToken}`
    }
    const response = await fetch(buildRemoteSessionListUrl(connection.config.baseUrl, directory), {
      headers,
      signal: AbortSignal.timeout(REMOTE_SESSION_LIST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const err = new Error(`session.list failed (${response.status})`)
      ;(err as Error & { status?: number }).status = response.status
      throw err
    }
    const data = await response.json()
    if (!Array.isArray(data)) {
      const err = new Error("session.list returned invalid data")
      ;(err as Error & { status?: number }).status = 503
      throw err
    }
    return data.filter((item): item is Session => Boolean(item?.id)) as Session[]
  }

  const result = await sdkClient.session.list({
    directory,
    roots: true,
    limit: 50,
  })
  const rawError = (result as { error?: unknown }).error
  if (rawError) {
    const response = (result as { response?: { status?: number } }).response
    const status = response?.status
    const message = typeof rawError === "object" && rawError !== null && "message" in rawError
      ? String((rawError as { message?: unknown }).message)
      : String(rawError)
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
