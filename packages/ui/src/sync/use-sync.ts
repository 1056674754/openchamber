import { useCallback, useRef, useMemo } from "react"
import type { Message, OpencodeClient, Part, SessionStatus, Todo } from "@opencode-ai/sdk/v2/client"
import { Binary } from "./binary"
import { retry } from "./retry"
import { SESSION_CACHE_LIMIT, type State } from "./types"
import { pickSessionCacheEvictions } from "./session-cache"
import {
  mergeOptimisticPage,
  type OptimisticItem,
} from "./optimistic"
import { dropCachedSessionMessageRecordsSnapshots, recoverInterruptedTurnAfterMessageLoad, resyncBlockingRequestsForDirectory, useDirectoryStore, useSyncDirectory, useChildStoreManager } from "./sync-context"
import { resolveSdkForDirectory } from "./session-actions"
import { requireExistingSessionDirectory } from "./session-routing"
import { useSessionUIStore } from "./session-ui-store"
import { getSyncStoresForServer } from "./multi-server-registry"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"
import { opencodeClient } from "@/lib/opencode/client"
import { dropSessionCaches, getProtectedSessionCacheIds } from "./session-cache"
import { isVSCodeRuntime } from "@/lib/desktop"
import {
  shouldSkipSessionPrefetch,
  getSessionPrefetch,
  setSessionPrefetch,
  clearSessionPrefetch,
} from "./session-prefetch-cache"
import { getSessionMaterializationStatus, materializeSessionSnapshots } from "./materialization"
import { useTodosPersistStore } from "@/stores/useTodosPersistStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import {
  getInitialHistoryRealUserTarget,
  getInteractiveHistoryRealUserTarget,
  loadMessageHistoryBatch,
  MessageHistoryLoadError,
} from "./message-history-loader"
import { createSinglePageHistoryPrefetch } from "./message-history-prefetch"
import { loadMessageHistoryThroughTarget } from "./prompt-history-loader"
import type { MessagePage } from "./message-page-boundary"
import { preserveCompleteHistoryCoverage, reconcileSyncMeta, type SyncMeta } from "./sync-meta"
import { formatSdkError } from "./sdk-error"
import { readRemoteSessionStatuses } from "./remote-session-status"
import { KeyedSingleFlight } from "./keyed-single-flight"
import { beginSyncSessionGeneration } from "./sync-session-generation"
import { findMessageIndex, insertMessageChronologically } from './message-ordering'

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const MESSAGE_PAGE_SIZE = 30
const VSCODE_MESSAGE_PAGE_SIZE = 30
const VSCODE_INITIAL_PAGE_EXPANSION_LIMITS = [50, 80, 120] as const
const MAX_SEEN_DIRS = 30
const VSCODE_SESSION_CACHE_LIMIT = 4

// Shared across useSync() instances so cache eviction is based on app-level
// session recency, not whichever component happened to call sync first.
const seenByDirectory = new Map<string, Set<string>>()
const sessionSingleFlight = new KeyedSingleFlight<string, void>()
const messageHistorySingleFlight = new KeyedSingleFlight<string, void>()

const readStatusesForTarget = async (
  client: OpencodeClient,
  serverId: string,
  directory: string,
): Promise<Record<string, SessionStatus>> => {
  if (serverId !== DEFAULT_SERVER_ID) {
    return readRemoteSessionStatuses(serverId, directory)
  }
  // R2 client unification: the host's per-directory status read (the v2
  // `{data}` envelope is unwrapped inside the client). Null means the fetch
  // failed — a failure must surface, not read as "everything idle".
  const statuses = await opencodeClient.getSessionStatusForDirectory(directory)
  if (!statuses) throw new Error('session.status failed: host status fetch returned no data')
  // The client's status record is structurally the legacy SessionStatus; the
  // store type stays legacy until the sync-bridge retype (R2 残留).
  return statuses as Record<string, SessionStatus>
}

export function logMessageHistoryLoadFailure(input: {
  readonly sessionID: string
  readonly directory: string
  readonly serverId: string
  readonly error: unknown
}): void {
  console.error("[sync] session.messages failed", {
    sessionID: input.sessionID,
    directory: input.directory,
    serverId: input.serverId,
    status: input.error instanceof MessageHistoryLoadError ? input.error.status : undefined,
    message: formatSdkError(input.error),
  }, input.error)
}

const getEffectiveSessionCacheLimit = () => isVSCodeRuntime() ? VSCODE_SESSION_CACHE_LIMIT : SESSION_CACHE_LIMIT
const getEffectiveMessagePageSize = () => isVSCodeRuntime() ? VSCODE_MESSAGE_PAGE_SIZE : MESSAGE_PAGE_SIZE
const getVSCodeInitialPageExpansionMax = () => VSCODE_INITIAL_PAGE_EXPANSION_LIMITS[VSCODE_INITIAL_PAGE_EXPANSION_LIMITS.length - 1]
const getDefaultMeta = (): SyncMeta => ({ limit: getEffectiveMessagePageSize(), cursor: undefined, complete: false, loading: false })

function getPrefetchMeta(directory: string, sessionID: string): SyncMeta | undefined {
  const info = getSessionPrefetch(directory, sessionID)
  if (!info) return undefined
  return {
    limit: info.limit,
    cursor: info.cursor,
    complete: info.complete,
    loading: false,
  }
}

function sortParts(parts: Part[]) {
  return parts.filter((p) => !!p?.id)
}

function isHeavyVSCodeSessionCache(state: Pick<State, "message" | "part">, sessionID: string): boolean {
  const messages = state.message[sessionID]
  if (!messages || messages.length === 0) return false
  return messages.length > VSCODE_MESSAGE_PAGE_SIZE
}

function isUserMessage(message: Message): boolean {
  const info = message as Message & { clientRole?: unknown; role?: unknown }
  const role = typeof info.clientRole === "string" ? info.clientRole : info.role
  return role === "user"
}

function hasUserMessage(messages: Message[] | undefined): boolean {
  return Boolean(messages?.some(isUserMessage))
}

// ---------------------------------------------------------------------------
// useSync — message loading, pagination, optimistic updates
// Message loading, pagination, optimistic updates
// ---------------------------------------------------------------------------

export function useSync() {
  const directory = useSyncDirectory()
  const store = useDirectoryStore()
  const childStores = useChildStoreManager()

  // Refs for mutable tracking (no re-renders)
  const optimistic = useRef(new Map<string, Map<string, OptimisticItem>>())
  const meta = useRef(new Map<string, SyncMeta>())
  const historyPrefetch = useRef(createSinglePageHistoryPrefetch<MessagePage>())

  const resolveSessionTarget = useCallback(
    (sessionID: string) => {
      const knownSessionDir = useSessionUIStore.getState().getDirectoryForSession(sessionID)
      const serverId = serverRegistry.getServerForSession(sessionID)

      if (serverId && serverId !== DEFAULT_SERVER_ID) {
        const remoteStores = getSyncStoresForServer(serverId)
        if (remoteStores) {
          for (const [candidateDirectory, candidate] of remoteStores.children) {
            if (candidate.getState().session.some((session) => session.id === sessionID)) {
              return {
                directory: candidateDirectory,
                store: candidate,
                serverId,
              }
            }
          }

          if (knownSessionDir) {
            const remoteStore = remoteStores.ensureChild(knownSessionDir)
            return {
              directory: knownSessionDir,
              store: remoteStore,
              serverId,
            }
          }
        }

        throw new Error(`Directory for remote session ${sessionID} on ${serverId} is not available`)
      }

      const targetDirectory = requireExistingSessionDirectory(sessionID, knownSessionDir)
      const targetStore = targetDirectory === directory
        ? store
        : childStores.ensureChild(targetDirectory)

      return {
        directory: targetDirectory,
        store: targetStore,
        serverId: DEFAULT_SERVER_ID,
      }
    },
    [childStores, directory, store],
  )

  const keyFor = useCallback(
    (sessionID: string, targetDirectory = directory) => `${targetDirectory}\n${sessionID}`,
    [directory],
  )

  const getMetaFor = useCallback(
    (sessionID: string, targetDirectory = directory) => {
      const key = keyFor(sessionID, targetDirectory)
      return reconcileSyncMeta(
        meta.current.get(key),
        getPrefetchMeta(targetDirectory, sessionID),
      ) ?? getDefaultMeta()
    },
    [directory, keyFor],
  )

  const setMetaFor = useCallback(
    (sessionID: string, patch: Partial<SyncMeta>, targetDirectory = directory) => {
      const key = keyFor(sessionID, targetDirectory)
      const current = reconcileSyncMeta(
        meta.current.get(key),
        getPrefetchMeta(targetDirectory, sessionID),
      ) ?? getDefaultMeta()
      meta.current.set(key, { ...current, ...patch })
    },
    [directory, keyFor],
  )

  // Session cache eviction — two levels of LRU:
  // (1) across directories (max 30), (2) within a directory (SESSION_CACHE_LIMIT).

  // Evict all cached session data for given IDs from a directory's store
  const evict = useCallback(
    (dir: string, sessionIDs: string[]) => {
      if (sessionIDs.length === 0) return
      const dirStore = childStores.getChild(dir)
      if (!dirStore) return

      const current = dirStore.getState()
      const draft = {
        message: { ...current.message },
        part: { ...current.part },
        session_status: { ...current.session_status },
        session_activity: { ...current.session_activity },
        session_diff: { ...current.session_diff },
        todo: { ...current.todo },
        permission: { ...current.permission },
        form: { ...current.form },
      }
      dropSessionCaches(draft, sessionIDs)
      dropCachedSessionMessageRecordsSnapshots(dirStore, sessionIDs)
      dirStore.setState(draft)

      // Clear meta + optimistic + prefetch cache for evicted sessions
      for (const id of sessionIDs) {
        optimistic.current.delete(`${dir}\n${id}`)
        meta.current.delete(`${dir}\n${id}`)
      }
      clearSessionPrefetch(dir, sessionIDs)
    },
    [childStores],
  )

  // Get or create the seen-set for a directory. LRU reorder on access.
  // When seen directories exceed MAX_SEEN_DIRS, evict the oldest directory's caches.
  // LRU reorder on access. Evicts oldest directory when exceeding MAX_SEEN_DIRS.
  const seenFor = useCallback(() => {
    const existing = seenByDirectory.get(directory)
    if (existing) {
      // LRU reorder: delete + re-insert moves to end (most recent)
      seenByDirectory.delete(directory)
      seenByDirectory.set(directory, existing)
      return existing
    }
    const created = new Set<string>()
    seenByDirectory.set(directory, created)

    // Evict oldest directories if over limit
    while (seenByDirectory.size > MAX_SEEN_DIRS) {
      const first = seenByDirectory.keys().next().value
      if (!first) break
      const staleSessionIds = [...(seenByDirectory.get(first) ?? [])]
      seenByDirectory.delete(first)
      evict(first, staleSessionIds)
    }

    return created
  }, [directory, evict])

  // Touch a session — triggers both directory-level and session-level eviction
  const touch = useCallback(
    (sessionID: string) => {
      const s = seenFor()
      const protectedIds = getProtectedSessionCacheIds(store.getState())
      const cacheLimit = getEffectiveSessionCacheLimit()
      const stale = pickSessionCacheEvictions({
        seen: s,
        keep: sessionID,
        limit: cacheLimit,
        preserve: protectedIds,
      })
      evict(directory, stale)

      if (isVSCodeRuntime()) {
        const state = store.getState()
        const keep = new Set([sessionID, ...s, ...protectedIds])
        const prefetched = Object.keys(state.message).filter((id) => !keep.has(id))
        evict(directory, prefetched)

        const afterPrefetchEviction = prefetched.length > 0 ? store.getState() : state
        const heavyInactive = Object.keys(afterPrefetchEviction.message).filter((id) => {
          if (id === sessionID || protectedIds.has(id)) return false
          return isHeavyVSCodeSessionCache(afterPrefetchEviction, id)
        })
        if (heavyInactive.length > 0) {
          for (const id of heavyInactive) s.delete(id)
          evict(directory, heavyInactive)
        }
      }
    },
    [directory, seenFor, evict, store],
  )

  // Optimistic operations
  const getOptimistic = useCallback(
    (sessionID: string, targetDirectory = directory): OptimisticItem[] => {
      const key = `${targetDirectory}\n${sessionID}`
      return [...(optimistic.current.get(key)?.values() ?? [])]
    },
    [directory],
  )

  const setOptimistic = useCallback(
    (sessionID: string, item: OptimisticItem, targetDirectory = directory) => {
      const key = `${targetDirectory}\n${sessionID}`
      const list = optimistic.current.get(key)
      const sorted: OptimisticItem = { message: item.message, parts: sortParts(item.parts) }
      if (list) {
        list.set(item.message.id, sorted)
      } else {
        optimistic.current.set(key, new Map([[item.message.id, sorted]]))
      }
    },
    [directory],
  )

  const clearOptimistic = useCallback(
    (sessionID: string, messageID?: string, targetDirectory = directory) => {
      const key = `${targetDirectory}\n${sessionID}`
      if (!messageID) {
        optimistic.current.delete(key)
        return
      }
      const list = optimistic.current.get(key)
      if (!list) return
      list.delete(messageID)
      if (list.size === 0) optimistic.current.delete(key)
    },
    [directory],
  )

  const fetchMessagesToUserBoundary = useCallback(
    async (input: {
      readonly sessionID: string
      readonly limit: number
      readonly before?: string
      readonly targetDirectory?: string
      readonly targetServerId?: string
    }) => {
      const targetDirectory = input.targetDirectory ?? directory
      const result = await loadMessageHistoryBatch({
        serverId: input.targetServerId,
        sessionID: input.sessionID,
        directory: targetDirectory,
        limit: input.limit,
        before: input.before,
        minimumRealUserMessages: input.before
          ? getInteractiveHistoryRealUserTarget(isVSCodeRuntime())
          : getInitialHistoryRealUserTarget(isVSCodeRuntime()),
      })

      if (result.stoppedBeforeBoundary) {
        console.warn("[sync] session.messages stopped before reaching the interactive turn target", JSON.stringify({
          sessionID: input.sessionID,
          targetDirectory,
          loadedMessageCount: result.page.session.length,
          extraPages: result.extraPages,
          hasCursor: Boolean(result.page.cursor),
          payloadBytes: result.page.payloadBytes,
        }))
      }

      return result.page
    },
    [directory],
  )

  const prefetchOlderMessages = useCallback((input: {
    readonly sessionID: string
    readonly targetDirectory: string
    readonly targetServerId: string
  }) => {
    if (useSessionUIStore.getState().currentSessionId !== input.sessionID) return

    const current = getMetaFor(input.sessionID, input.targetDirectory)
    if (current.complete || !current.cursor) return

    const cursor = current.cursor
    const prefetchKey = `${input.targetDirectory}\n${input.sessionID}\n${cursor}`
    const request = historyPrefetch.current.prepare(prefetchKey, () => fetchMessagesToUserBoundary({
      sessionID: input.sessionID,
      limit: getEffectiveMessagePageSize(),
      before: cursor,
      targetDirectory: input.targetDirectory,
      targetServerId: input.targetServerId,
    }))
    void request.catch((error: unknown) => {
      console.warn("[sync] failed to prefetch older message history", {
        sessionID: input.sessionID,
        targetDirectory: input.targetDirectory,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  }, [fetchMessagesToUserBoundary, getMetaFor])

  // Load messages for a session.
  const loadMessages = useCallback(
    async (sessionID: string, options?: {
      before?: string
      mode?: "replace" | "prepend"
      targetDirectory?: string
      targetStore?: typeof store
      targetServerId?: string
      throwOnError?: boolean
      prefetchedPage?: Promise<MessagePage>
      throughMessageID?: string
      isStale?: () => boolean
    }) => {
      const writeStore = options?.targetStore ?? store
      const targetDirectory = options?.targetDirectory ?? directory
      const targetServerId = options?.targetServerId ?? DEFAULT_SERVER_ID
      const historyKey = `${targetServerId}\n${keyFor(sessionID, targetDirectory)}`
      await messageHistorySingleFlight.run(historyKey, async () => {
        const m = getMetaFor(sessionID, targetDirectory)
        if (m.loading) return
        setMetaFor(sessionID, { loading: true }, targetDirectory)

        try {
        const limit = options?.before ? getEffectiveMessagePageSize() : m.limit
        const preparedPage = options?.prefetchedPage
          ? await options.prefetchedPage.then(
            (value) => value,
            () => undefined,
          )
          : undefined
        let page = options?.before && options.throughMessageID
          ? (await loadMessageHistoryThroughTarget({
              serverId: options.targetServerId,
              sessionID,
              directory: targetDirectory,
              limit,
              before: options.before,
              targetMessageID: options.throughMessageID,
            })).page
          : preparedPage ?? await fetchMessagesToUserBoundary({
              sessionID,
              limit,
              before: options?.before,
              targetDirectory,
              targetServerId: options?.targetServerId,
            })

        // VS Code keeps the initial page small for switch performance. Some
        // sessions have a very large final turn, so the latest 30 records can
        // contain only assistant/tool records and no user boundary. Expand only
        // this initial tail fetch, with a hard cap.
        if (!options?.before && isVSCodeRuntime() && !page.complete && !hasUserMessage(page.session)) {
          for (const nextLimit of VSCODE_INITIAL_PAGE_EXPANSION_LIMITS) {
            if (nextLimit <= limit) continue
            page = await fetchMessagesToUserBoundary({
              sessionID,
              limit: nextLimit,
              targetDirectory,
              targetServerId: options?.targetServerId,
            })
            if (page.complete || hasUserMessage(page.session)) break
          }
        }

        if (options?.isStale?.()) {
          setMetaFor(sessionID, { loading: false }, targetDirectory)
          return
        }

        // Merge optimistic items
        const items = getOptimistic(sessionID, targetDirectory)
        const merged = mergeOptimisticPage(page, items)
        for (const messageID of merged.confirmed) {
          clearOptimistic(sessionID, messageID, targetDirectory)
        }

        const current = writeStore.getState()
        const materialized = materializeSessionSnapshots(
          current,
          sessionID,
          merged.session.map((info) => ({
            info,
            parts: merged.part.find((item) => item.id === info.id)?.part ?? [],
          })),
          { skipPartTypes: SKIP_PARTS, mode: options?.mode === "prepend" ? "prepend" : options?.mode === "replace" ? "replace" : "merge" },
        )

        if (options?.isStale?.()) {
          setMetaFor(sessionID, { loading: false }, targetDirectory)
          return
        }

        const message = Object.prototype.hasOwnProperty.call(materialized.message, sessionID)
          ? materialized.message
          : { ...materialized.message, [sessionID]: materialized.messages }
        const coverage = options?.before
          ? { cursor: merged.cursor, complete: merged.complete }
          : preserveCompleteHistoryCoverage(m, merged)
        setMetaFor(sessionID, {
          limit: materialized.messages.length,
          cursor: coverage.cursor,
          complete: coverage.complete,
          loading: false,
        }, targetDirectory)
        writeStore.setState({ message, part: materialized.part })
        setSessionPrefetch({
          directory: targetDirectory,
          sessionID,
          limit: materialized.messages.length,
          cursor: coverage.cursor,
          complete: coverage.complete,
        })
        prefetchOlderMessages({
          sessionID,
          targetDirectory,
          targetServerId: options?.targetServerId ?? DEFAULT_SERVER_ID,
        })
        } catch (error) {
          setMetaFor(sessionID, { loading: false }, targetDirectory)
          logMessageHistoryLoadFailure({
            sessionID,
            directory: targetDirectory,
            serverId: targetServerId,
            error,
          })
          if (options?.throwOnError) {
            throw error
          }
        }
      })
    },
    [store, fetchMessagesToUserBoundary, getMetaFor, setMetaFor, getOptimistic, clearOptimistic, directory, keyFor, prefetchOlderMessages],
  )

  // Sync a session (load if not cached)
  const syncSession = useCallback(
    async (sessionID: string, force?: boolean) => {
      const target = resolveSessionTarget(sessionID)
      if (target.serverId === DEFAULT_SERVER_ID) {
        touch(sessionID)
      }
      const key = `${target.serverId}\n${keyFor(sessionID, target.directory)}`
      return sessionSingleFlight.run(key, async () => {
        // New flight: bump generation so older in-flight loads for this key
        // (e.g. previous lifecycle) know not to write after they finish.
        const isStale = beginSyncSessionGeneration(key)
        const current = target.store.getState()
        const m = getMetaFor(sessionID, target.directory)
        const materialization = getSessionMaterializationStatus(current, sessionID)
        const cached = materialization.hasMessages && materialization.renderable && m.limit > 0
        const prefetchInfo = !force ? getSessionPrefetch(target.directory, sessionID) : undefined
        const knownCachedLimit = Math.max(m.limit, prefetchInfo?.limit ?? 0)
        const needsVSCodeInitialTurnBoundary = isVSCodeRuntime()
          && cached
          && !hasUserMessage(current.message[sessionID])
          && knownCachedLimit < getVSCodeInitialPageExpansionMax()
          && !m.complete
          && prefetchInfo?.complete !== true
          && Boolean(m.cursor ?? prefetchInfo?.cursor)
        if (needsVSCodeInitialTurnBoundary && prefetchInfo && prefetchInfo.limit > m.limit) {
          setMetaFor(sessionID, {
            limit: prefetchInfo.limit,
            cursor: prefetchInfo.cursor,
            complete: prefetchInfo.complete,
          }, target.directory)
        }
        const cachedReady = cached && !needsVSCodeInitialTurnBoundary
        const hasSession = Binary.search(current.session, sessionID, (s) => s.id).found
        if (cachedReady && hasSession && !force) {
          // The cached transcript can postdate the status snapshot that
          // settled this session; re-check an interrupted trailing turn.
          await recoverInterruptedTurnAfterMessageLoad(target.directory, target.store, sessionID, target.serverId, isStale)
          return
        }

        if (!force && !needsVSCodeInitialTurnBoundary) {
          if (shouldSkipSessionPrefetch({
            hasMessages: cachedReady,
            info: prefetchInfo,
            pageSize: getEffectiveMessagePageSize(),
          })) return
        }

        if (!hasSession || force) {
          try {
            const sessionDir = target.directory
            const client = resolveSdkForDirectory(sessionDir, sessionID, target.serverId)
            const result = await retry(() => client.session.get({ sessionID, directory: sessionDir }))
            if (result.data && !isStale()) {
              const s = target.store.getState()
              const sessions = [...s.session]
              const idx = Binary.search(sessions, sessionID, (s) => s.id)
              if (idx.found) {
                sessions[idx.index] = result.data
              } else {
                sessions.splice(idx.index, 0, result.data)
              }
              if (!isStale()) {
                target.store.setState({ session: sessions })
              }
            }
          } catch (e) {
            console.error("[sync] failed to fetch session", sessionID, e)
          }
        }

        if (!cachedReady || force) {
          const client = resolveSdkForDirectory(target.directory, sessionID, target.serverId)
          const loadChildren = client.session.children({
            sessionID,
            directory: target.directory,
          }).then((result) => {
            if (isStale()) return
            if (result.error) {
              throw new Error(`session.children failed: ${formatSdkError(result.error)}`)
            }

            const children = result.data ?? []
            if (children.length === 0) return

            const state = target.store.getState()
            let sessions = state.session
            for (const child of children) {
              const index = Binary.search(sessions, child.id, (session) => session.id)
              if (index.found) continue
              if (sessions === state.session) sessions = [...sessions]
              sessions.splice(index.index, 0, child)
            }
            if (sessions !== state.session && !isStale()) {
              target.store.setState({ session: sessions })
            }
          }).catch((error: unknown) => {
            console.warn("[sync] failed to hydrate session children", {
              sessionID,
              directory: target.directory,
              serverId: target.serverId,
              error: formatSdkError(error),
            })
          })

          await Promise.all([
            loadMessages(sessionID, {
              targetDirectory: target.directory,
              targetStore: target.store,
              targetServerId: target.serverId,
              isStale,
            }),
            loadChildren,
          ])
        }

        if (!isStale()) {
          await recoverInterruptedTurnAfterMessageLoad(target.directory, target.store, sessionID, target.serverId, isStale)
        }

        if (force) {
          const sessionDir = target.directory
          const client = resolveSdkForDirectory(sessionDir, sessionID, target.serverId)
          await Promise.all([
            readStatusesForTarget(client, target.serverId, sessionDir).then((statuses) => {
              const status = statuses[sessionID] ?? { type: "idle" as const }
              target.store.setState((s) => ({
                session_status: { ...s.session_status, [sessionID]: status },
              }))
              useGlobalSessionsStore.getState().upsertStatus(sessionID, status)
            }).catch(() => {}),
            client.session.todo({ sessionID, directory: sessionDir }).then((res) => {
              const todos: Todo[] | undefined = res.data && res.data.length > 0 ? res.data : undefined
              target.store.setState((s) => ({
                todo: { ...s.todo, [sessionID]: todos ?? [] },
              }))
              useTodosPersistStore.getState().setSessionTodos(sessionID, todos)
            }).catch(() => {}),
          ])
        }
      })
    },
    [keyFor, touch, getMetaFor, setMetaFor, loadMessages, resolveSessionTarget],
  )

  const forceRefreshSession = useCallback(
    async (sessionID: string): Promise<{ ok: boolean; error?: string }> => {
      const target = resolveSessionTarget(sessionID)
      const sessionDir = target.directory
      const generationKey = `${target.serverId}\n${keyFor(sessionID, sessionDir)}`
      const isStale = beginSyncSessionGeneration(generationKey)

      // 1. Clear stale loading state so loadMessages won't short-circuit.
      setMetaFor(sessionID, { loading: false }, sessionDir)

      // 2. Connection health check (local server only).
      if (target.serverId === DEFAULT_SERVER_ID) {
        const connected = await useConfigStore.getState().checkConnection()
        if (!connected) {
          return { ok: false, error: "Connection to OpenCode server failed" }
        }
      }

      // 3. Fetch session metadata.
      const client = resolveSdkForDirectory(sessionDir, sessionID, target.serverId)
      try {
        const result = await retry(() => client.session.get({ sessionID, directory: sessionDir }))
        if (result.data && !isStale()) {
          const s = target.store.getState()
          const sessions = [...s.session]
          const idx = Binary.search(sessions, sessionID, (s) => s.id)
          if (idx.found) {
            sessions[idx.index] = result.data
          } else {
            sessions.splice(idx.index, 0, result.data)
          }
          if (!isStale()) {
            target.store.setState({ session: sessions })
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Failed to fetch session: ${msg}` }
      }

      // 4. Load messages + parts.
      try {
        await loadMessages(sessionID, {
          mode: "replace",
          targetDirectory: sessionDir,
          targetStore: target.store,
          targetServerId: target.serverId,
          throwOnError: true,
          isStale,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Failed to load messages: ${msg}` }
      }

      if (isStale()) {
        return { ok: true }
      }

      try {
        const statuses = await readStatusesForTarget(client, target.serverId, sessionDir)
        if (isStale()) return { ok: true }
        const status = statuses[sessionID] ?? { type: "idle" as const }
        target.store.setState((s) => ({
          session_status: { ...s.session_status, [sessionID]: status },
        }))
        useGlobalSessionsStore.getState().upsertStatus(sessionID, status)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Failed to refresh session status: ${msg}` }
      }

      try {
        if (isStale()) return { ok: true }
        const result = await client.session.todo({ sessionID, directory: sessionDir })
        if (result.error) throw new Error(`session.todo failed: ${formatSdkError(result.error)}`)
        const todos: Todo[] | undefined = result.data && result.data.length > 0 ? result.data : undefined
        if (!isStale()) {
          target.store.setState((s) => ({
            todo: { ...s.todo, [sessionID]: todos ?? [] },
          }))
          useTodosPersistStore.getState().setSessionTodos(sessionID, todos)
        }
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        console.warn("[sync] failed to refresh session todos", {
          sessionID,
          directory: sessionDir,
          serverId: target.serverId,
          error: formatSdkError(error),
        })
      }

      return { ok: true }
    },
    [resolveSessionTarget, setMetaFor, loadMessages, keyFor],
  )

  // Load more (pagination)
  const loadMore = useCallback(
    async (sessionID: string) => {
      const target = resolveSessionTarget(sessionID)
      if (target.serverId === DEFAULT_SERVER_ID) {
        touch(sessionID)
      }
      const m = getMetaFor(sessionID, target.directory)
      if (m.loading || m.complete || !m.cursor) return
      const prefetchKey = `${target.directory}\n${sessionID}\n${m.cursor}`
      await loadMessages(sessionID, {
        before: m.cursor,
        mode: "prepend",
        targetDirectory: target.directory,
        targetStore: target.store,
        targetServerId: target.serverId,
        prefetchedPage: historyPrefetch.current.take(prefetchKey),
        throwOnError: true,
      })
    },
    [touch, getMetaFor, loadMessages, resolveSessionTarget],
  )

  const loadThroughMessage = useCallback(
    async (sessionID: string, messageID: string): Promise<boolean> => {
      const target = resolveSessionTarget(sessionID)
      let currentMessages = target.store.getState().message[sessionID] ?? []
      if (currentMessages.some((message) => message.id === messageID)) return true

      let m = getMetaFor(sessionID, target.directory)
      if (m.loading) {
        await loadMessages(sessionID, {
          targetDirectory: target.directory,
          targetStore: target.store,
          targetServerId: target.serverId,
        })
        currentMessages = target.store.getState().message[sessionID] ?? []
        if (currentMessages.some((message) => message.id === messageID)) return true
        m = getMetaFor(sessionID, target.directory)
      }
      if (m.complete || !m.cursor) return false
      await loadMessages(sessionID, {
        before: m.cursor,
        mode: "prepend",
        targetDirectory: target.directory,
        targetStore: target.store,
        targetServerId: target.serverId,
        throughMessageID: messageID,
        throwOnError: true,
      })

      currentMessages = target.store.getState().message[sessionID] ?? []
      return currentMessages.some((message) => message.id === messageID)
    },
    [getMetaFor, loadMessages, resolveSessionTarget],
  )

  const hasMore = useCallback(
    (sessionID: string) => {
      const target = resolveSessionTarget(sessionID)
      const m = getMetaFor(sessionID, target.directory)
      return !m.complete && !!m.cursor
    },
    [getMetaFor, resolveSessionTarget],
  )

  const isLoading = useCallback(
    (sessionID: string) => {
      const target = resolveSessionTarget(sessionID)
      return getMetaFor(sessionID, target.directory).loading
    },
    [getMetaFor, resolveSessionTarget],
  )

  const isComplete = useCallback(
    (sessionID: string) => {
      const target = resolveSessionTarget(sessionID)
      return getMetaFor(sessionID, target.directory).complete
    },
    [getMetaFor, resolveSessionTarget],
  )

  const recoverPendingForms = useCallback(
    async (input: { readonly sessionID: string; readonly directory: string; readonly serverId: string }): Promise<boolean> => {
      const indexedServerId = serverRegistry.getServerForSession(input.sessionID)
      const targetServerId = indexedServerId ?? input.serverId
      const indexedDirectory = useSessionUIStore.getState().getDirectoryForSession(input.sessionID)
      const targetDirectory = indexedDirectory ?? input.directory
      const targetStore = targetServerId === DEFAULT_SERVER_ID
        ? (targetDirectory === directory ? store : childStores.ensureChild(targetDirectory))
        : getSyncStoresForServer(targetServerId)?.ensureChild(targetDirectory)
      if (!targetStore) return false

      const result = await resyncBlockingRequestsForDirectory(targetDirectory, targetStore, [input.sessionID], {
        serverId: targetServerId,
        sdk: serverRegistry.get(targetServerId)?.client,
        includePermissions: false,
      })
      return result.forms && (targetStore.getState().form[input.sessionID]?.length ?? 0) > 0
    },
    [childStores, directory, store],
  )

  const resolveOptimisticTarget = useCallback(
    (input: { sessionID: string; directory?: string | null; serverId?: string | null }) => {
      const hintedDirectory = input.directory || undefined
      const hintedServerId = input.serverId ?? serverRegistry.getServerForSession(input.sessionID)
      if (hintedServerId && hintedServerId !== DEFAULT_SERVER_ID) {
        const remoteStores = getSyncStoresForServer(hintedServerId)
        if (remoteStores) {
          const targetDirectory = hintedDirectory
            ?? useSessionUIStore.getState().getDirectoryForSession(input.sessionID)
            ?? directory
          return {
            directory: targetDirectory,
            store: remoteStores.ensureChild(targetDirectory),
          }
        }
      }

      if (hintedDirectory) {
        return {
          directory: hintedDirectory,
          store: childStores.ensureChild(hintedDirectory),
        }
      }

      return resolveSessionTarget(input.sessionID)
    },
    [childStores, directory, resolveSessionTarget],
  )

  // Optimistic add (for prompt submission)
  const optimisticAdd = useCallback(
    (input: { sessionID: string; message: Message; parts: Part[]; directory?: string | null; serverId?: string | null }) => {
      const target = resolveOptimisticTarget(input)
      const targetDirectory = target.directory
      const targetStore = target.store
      setOptimistic(input.sessionID, { message: input.message, parts: input.parts }, targetDirectory)
      const current = targetStore.getState()
      const message = { ...current.message }
      const part = { ...current.part }

      // Insert message
      const messages = message[input.sessionID] ? [...message[input.sessionID]] : []
      if (findMessageIndex(messages, input.message.id) < 0) insertMessageChronologically(messages, input.message)
      message[input.sessionID] = messages

      // Insert parts
      part[input.message.id] = sortParts(input.parts)

      targetStore.setState({ message, part })
    },
    [resolveOptimisticTarget, setOptimistic],
  )

  // Optimistic remove (for rollback on error)
  const optimisticRemove = useCallback(
    (input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => {
      const target = resolveOptimisticTarget(input)
      const targetDirectory = target.directory
      const targetStore = target.store
      clearOptimistic(input.sessionID, input.messageID, targetDirectory)
      const current = targetStore.getState()
      const message = { ...current.message }
      const part = { ...current.part }

      const messages = message[input.sessionID]
      if (messages) {
        const next = [...messages]
        const messageIndex = findMessageIndex(next, input.messageID)
        if (messageIndex >= 0) {
          next.splice(messageIndex, 1)
          message[input.sessionID] = next
        }
      }
      delete part[input.messageID]

      targetStore.setState({ message, part })
    },
    [clearOptimistic, resolveOptimisticTarget],
  )

  const optimisticConfirm = useCallback(
    (input: { sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }) => {
      const target = resolveOptimisticTarget(input)
      clearOptimistic(input.sessionID, input.messageID, target.directory)
    },
    [clearOptimistic, resolveOptimisticTarget],
  )

  return useMemo(
    () => ({
      ensureSessionRenderable: syncSession,
      syncSession,
      forceRefreshSession,
      loadMore,
      loadThroughMessage,
      hasMore,
      isLoading,
      isComplete,
      recoverPendingForms,
      optimistic: {
        add: optimisticAdd,
        remove: optimisticRemove,
        confirm: optimisticConfirm,
      },
    }),
    [syncSession, forceRefreshSession, loadMore, loadThroughMessage, hasMore, isLoading, isComplete, recoverPendingForms, optimisticAdd, optimisticRemove, optimisticConfirm],
  )
}
