import type { Session } from "@opencode-ai/sdk/v2"

import { normalizePath } from "@/lib/pathNormalization"
import { serverRegistry } from "@/lib/opencode/server-registry"
import { retry } from "./retry"
import { KeyedRemoteReadCache, sharedRemoteReadScheduler } from "./remote-read-scheduler"
import { listSessionsForBootstrap } from "./session-list-bootstrap"

export const REMOTE_SESSION_SUMMARY_TTL_MS = 30_000

type LoadDirectory = (
  serverId: string,
  directory: string,
  signal?: AbortSignal,
) => Promise<Session[]>

type RemoteSessionSummarySyncOptions = {
  loadDirectory: LoadDirectory
  ttlMs?: number
  now?: () => number
}

type RemoteSessionSummaryScan = {
  serverId: string
  directories: Iterable<string>
  signal?: AbortSignal
  onSnapshot: (directory: string, sessions: Session[]) => void
}

export type RemoteSessionSummaryScanResult = {
  scannedDirectories: string[]
  failedDirectories: string[]
  failures: Array<{ directory: string; error: unknown }>
}

const isAbortError = (error: unknown): boolean => (
  typeof error === "object"
  && error !== null
  && "name" in error
  && error.name === "AbortError"
)

export const createRemoteSessionSummarySync = (options: RemoteSessionSummarySyncOptions) => {
  const ttlMs = options.ttlMs ?? REMOTE_SESSION_SUMMARY_TTL_MS
  const now = options.now ?? Date.now
  const loadedAt = new Map<string, number>()

  const scan = async (input: RemoteSessionSummaryScan): Promise<RemoteSessionSummaryScanResult> => {
    const directories = new Set<string>()
    for (const candidate of input.directories) {
      const directory = normalizePath(candidate)
      if (directory && directory !== "/") directories.add(directory)
    }

    const scanStartedAt = now()
    const targets = [...directories].filter((directory) => {
      const key = `${input.serverId}\n${directory}`
      const previous = loadedAt.get(key)
      return previous === undefined || scanStartedAt - previous >= ttlMs
    })

    const results = await Promise.all(targets.map(async (directory) => {
      try {
        const sessions = await options.loadDirectory(input.serverId, directory, input.signal)
        input.onSnapshot(directory, sessions)
        loadedAt.set(`${input.serverId}\n${directory}`, now())
        return { directory, ok: true as const }
      } catch (error) {
        if (isAbortError(error)) throw error
        return { directory, ok: false as const, error }
      }
    }))

    const failures = results
      .filter((result): result is { directory: string; ok: false; error: unknown } => !result.ok)
      .map((result) => ({ directory: result.directory, error: result.error }))

    return {
      scannedDirectories: results.filter((result) => result.ok).map((result) => result.directory),
      failedDirectories: failures.map((failure) => failure.directory),
      failures,
    }
  }

  const invalidate = (serverId: string, directory?: string): void => {
    if (directory) {
      const normalized = normalizePath(directory)
      if (normalized) loadedAt.delete(`${serverId}\n${normalized}`)
      return
    }
    const prefix = `${serverId}\n`
    for (const key of loadedAt.keys()) {
      if (key.startsWith(prefix)) loadedAt.delete(key)
    }
  }

  return { scan, invalidate }
}

const sessionSummaryReads = new KeyedRemoteReadCache<Session[]>(sharedRemoteReadScheduler)

export const remoteSessionSummarySync = createRemoteSessionSummarySync({
  loadDirectory: async (serverId, directory, signal) => {
    const connection = serverRegistry.get(serverId)
    if (!connection || connection.healthStatus !== "healthy") {
      throw new Error(`Remote server ${serverId} is not healthy`)
    }

    return sessionSummaryReads.schedule(
      serverId,
      `session.list:${directory}`,
      () => retry(
        () => listSessionsForBootstrap(connection.client, serverId, directory, signal),
        {
          attempts: 3,
          delay: 500,
          factor: 2,
          maxDelay: 15_000,
          jitter: 0.25,
          signal,
        },
      ),
      { priority: "background" },
    )
  },
})
