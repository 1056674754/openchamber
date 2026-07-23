import React from "react"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { serverRegistry } from "@/lib/opencode/server-registry"
import { resolveSdkForDirectory } from "@/sync/session-actions"
import {
  loadCompleteUserPromptHistory,
  type CompleteUserPromptHistoryResult,
} from "@/sync/prompt-history-loader"
import { formatSdkError } from "@/sync/sdk-error"

type PromptHistoryRecord = {
  readonly info: Message
  readonly parts: Part[]
}

type PromptHistorySnapshot = {
  readonly records: readonly PromptHistoryRecord[]
  readonly complete: boolean
}

type KeyedPromptHistorySnapshot = {
  readonly key: string
  readonly snapshot: PromptHistorySnapshot
}

type UseCompletePromptHistoryInput = {
  readonly enabled: boolean
  readonly sessionID: string | null
  readonly directory: string
}

type PromptHistoryListener = (snapshot: PromptHistorySnapshot) => void

type PromptHistoryLoad = {
  readonly promise: Promise<PromptHistorySnapshot>
  readonly subscribe: (listener: PromptHistoryListener) => () => void
}

const EMPTY_SNAPSHOT: PromptHistorySnapshot = { records: [], complete: false }
const CACHE_LIMIT = 30
const PAGE_SIZE = 100
const historyCache = new Map<string, PromptHistorySnapshot>()
const inFlightLoads = new Map<string, PromptHistoryLoad>()

const cacheSnapshot = (key: string, snapshot: PromptHistorySnapshot): void => {
  historyCache.delete(key)
  while (historyCache.size >= CACHE_LIMIT) {
    const oldest = historyCache.keys().next().value
    if (typeof oldest !== "string") break
    historyCache.delete(oldest)
  }
  historyCache.set(key, snapshot)
}

const toSnapshot = (result: CompleteUserPromptHistoryResult): PromptHistorySnapshot => ({
  records: result.records.map((record) => ({ info: record.info, parts: [...record.parts] })),
  complete: result.complete,
})

const loadPromptHistory = (input: {
  readonly key: string
  readonly serverID: string
  readonly sessionID: string
  readonly directory: string
}): PromptHistoryLoad => {
  const existing = inFlightLoads.get(input.key)
  if (existing) return existing

  const listeners = new Set<PromptHistoryListener>()
  let snapshot = historyCache.get(input.key) ?? EMPTY_SNAPSHOT
  const publish = (result: CompleteUserPromptHistoryResult): void => {
    snapshot = toSnapshot(result)
    cacheSnapshot(input.key, snapshot)
    for (const listener of listeners) listener(snapshot)
  }

  const client = resolveSdkForDirectory(input.directory, input.sessionID, input.serverID)
  const request = loadCompleteUserPromptHistory({
    client,
    sessionID: input.sessionID,
    directory: input.directory,
    limit: PAGE_SIZE,
    onProgress: publish,
  }).then(() => {
    return snapshot
  })

  const load: PromptHistoryLoad = {
    promise: request,
    subscribe: (listener) => {
      listeners.add(listener)
      if (snapshot.records.length > 0 || snapshot.complete) listener(snapshot)
      return () => listeners.delete(listener)
    },
  }
  inFlightLoads.set(input.key, load)
  const clearInFlight = () => {
    if (inFlightLoads.get(input.key) === load) {
      inFlightLoads.delete(input.key)
    }
  }
  void request.then(clearInFlight, clearInFlight)
  return load
}

export function useCompletePromptHistory(input: UseCompletePromptHistoryInput): PromptHistorySnapshot {
  const serverID = input.sessionID ? serverRegistry.getServerForSession(input.sessionID) ?? "default" : "default"
  const key = input.sessionID ? `${serverID}\n${input.sessionID}` : ""
  const [state, setState] = React.useState<KeyedPromptHistorySnapshot>(() => ({
    key,
    snapshot: historyCache.get(key) ?? EMPTY_SNAPSHOT,
  }))
  const snapshot = state.key === key ? state.snapshot : historyCache.get(key) ?? EMPTY_SNAPSHOT

  React.useEffect(() => {
    if (!input.enabled || !input.sessionID) {
      setState({ key, snapshot: EMPTY_SNAPSHOT })
      return
    }

    const cached = historyCache.get(key)
    if (cached?.complete) {
      setState({ key, snapshot: cached })
      return
    }

    let active = true
    const load = loadPromptHistory({
      key,
      serverID,
      sessionID: input.sessionID,
      directory: input.directory,
    })
    const unsubscribe = load.subscribe((next) => {
      if (!active) return
      setState({ key, snapshot: next })
    })

    void load.promise.then(
      () => undefined,
      (error: unknown) => {
        if (!active) return
        console.warn("[prompt-history] failed to build complete user-turn index", {
          sessionID: input.sessionID,
          directory: input.directory,
          serverID,
          error: formatSdkError(error),
        })
      },
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [input.directory, input.enabled, input.sessionID, key, serverID])

  return snapshot
}
