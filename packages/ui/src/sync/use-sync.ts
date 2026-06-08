import { useCallback, useRef, useMemo } from "react"
import type { Message, Part, Todo } from "@opencode-ai/sdk/v2/client"
import { Binary } from "./binary"
import { retry } from "./retry"
import { SESSION_CACHE_LIMIT, type State } from "./types"
import { pickSessionCacheEvictions } from "./session-cache"
import {
  mergeOptimisticPage,
  type OptimisticItem,
} from "./optimistic"
import { dropCachedSessionMessageRecordsSnapshots, useDirectoryStore, useSyncDirectory, useChildStoreManager } from "./sync-context"
import { resolveSdkForDirectory } from "./session-actions"
import { useSessionUIStore } from "./session-ui-store"
import { getSyncStoresForServer } from "./multi-server-registry"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"
import { dropSessionCaches, getProtectedSessionCacheIds } from "./session-cache"
import { stripMessageDiffSnapshots } from "./sanitize"
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
import { fetchMessagePageToUserBoundary, type MessagePage } from "./message-page-boundary"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const MESSAGE_PAGE_SIZE = 150
const VSCODE_MESSAGE_PAGE_SIZE = 30
const VSCODE_INITIAL_PAGE_EXPANSION_LIMITS = [50, 80, 120] as const
const MAX_SEEN_DIRS = 30
const VSCODE_SESSION_CACHE_LIMIT = 4
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Shared across useSync() instances so cache eviction is based on app-level
// session recency, not whichever component happened to call sync first.
const seenByDirectory = new Map<string, Set<string>>()

type SyncMeta = {
  limit: number
  cursor: string | undefined
  complete: boolean
  loading: boolean
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
  return parts.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id))
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

function unwrapMessageRecords<T>(
  result: { data?: T[]; error?: unknown; response?: { status?: number } },
  name: string,
): T[] {
  if (result.error) {
    const status = result.response?.status
    const rawError = result.error
    const message = typeof rawError === "object" && rawError !== null && "message" in rawError
      ? String((rawError as { message?: unknown }).message)
      : String(rawError)
    const error = new Error(`${name} failed${status ? ` (${status})` : ""}: ${message}`)
    if (status !== undefined) {
      ;(error as Error & { status?: number }).status = status
    }
    throw error
  }
  if (result.data === undefined) {
    const error = new Error(`${name} returned no data`)
    ;(error as Error & { status?: number }).status = 503
    throw error
  }
  return result.data
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
  const inflight = useRef(new Map<string, Promise<void>>())
  const optimistic = useRef(new Map<string, Map<string, OptimisticItem>>())
  const meta = useRef(new Map<string, SyncMeta>())

  const resolveSessionTarget = useCallback(
    (sessionID: string) => {
      const sessionDir = useSessionUIStore.getState().getDirectoryForSession(sessionID) || directory
      const serverId = serverRegistry.getServerForSession(sessionID)

      if (serverId && serverId !== DEFAULT_SERVER_ID) {
        const remoteStores = getSyncStoresForServer(serverId)
        if (remoteStores) {
          let resolvedDirectory = sessionDir
          let remoteStore = resolvedDirectory ? remoteStores.ensureChild(resolvedDirectory) : undefined
          if (!remoteStore) {
            for (const [candidateDirectory, candidate] of remoteStores.children) {
              if (candidate.getState().session.some((session) => session.id === sessionID)) {
                resolvedDirectory = candidateDirectory
                remoteStore = candidate
                break
              }
            }
          }
          if (remoteStore) {
            return {
              directory: resolvedDirectory,
              store: remoteStore,
              serverId,
            }
          }
        }
      }

      const targetDirectory = sessionDir || directory
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
      return meta.current.get(key) ?? getPrefetchMeta(targetDirectory, sessionID) ?? getDefaultMeta()
    },
    [directory, keyFor],
  )

  const setMetaFor = useCallback(
    (sessionID: string, patch: Partial<SyncMeta>, targetDirectory = directory) => {
      const key = keyFor(sessionID, targetDirectory)
      const current = meta.current.get(key) ?? getPrefetchMeta(targetDirectory, sessionID) ?? getDefaultMeta()
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
        session_diff: { ...current.session_diff },
        todo: { ...current.todo },
        permission: { ...current.permission },
        question: { ...current.question },
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

  // Fetch messages from API
  const fetchMessages = useCallback(
    async (sessionID: string, limit: number, before?: string, targetDirectory = directory, targetServerId?: string): Promise<MessagePage> => {
      const client = resolveSdkForDirectory(targetDirectory, sessionID, targetServerId)
      const result = await retry(() =>
        client.session.messages({ sessionID, directory: targetDirectory, limit, before }),
      )
      const items = unwrapMessageRecords(result, "session.messages")
        .filter((x: { info?: { id?: string } }) => !!x?.info?.id)
      const session = items
        .map((x: { info: Message }) => stripMessageDiffSnapshots(x.info))
        .sort((a: Message, b: Message) => cmp(a.id, b.id))
      const part = items.map((x: { info: { id: string }; parts: Part[] }) => ({
        id: x.info.id,
        part: sortParts(x.parts),
      }))
      const cursor = result.response?.headers?.get?.("x-next-cursor") ?? undefined
      return { session, part, cursor, complete: !cursor }
    },
    [directory],
  )

  const fetchMessagesToUserBoundary = useCallback(
    async (
      sessionID: string,
      limit: number,
      before?: string,
      targetDirectory = directory,
      targetServerId?: string,
    ): Promise<MessagePage> => {
      const result = await fetchMessagePageToUserBoundary({
        page: await fetchMessages(sessionID, limit, before, targetDirectory, targetServerId),
        fetchOlder: (cursor) => fetchMessages(sessionID, limit, cursor, targetDirectory, targetServerId),
      })

      if (result.stoppedBeforeBoundary) {
        console.warn("[sync] session.messages stopped before reaching a user boundary", {
          sessionID,
          targetDirectory,
          loadedMessageCount: result.page.session.length,
          extraPages: result.extraPages,
          hasCursor: Boolean(result.page.cursor),
        })
      }

      return result.page
    },
    [directory, fetchMessages],
  )

  // Load messages for a session.
  const loadMessages = useCallback(
    async (sessionID: string, options?: {
      before?: string
      mode?: "replace" | "prepend"
      targetDirectory?: string
      targetStore?: typeof store
      targetServerId?: string
    }) => {
      const writeStore = options?.targetStore ?? store
      const targetDirectory = options?.targetDirectory ?? directory
      const m = getMetaFor(sessionID, targetDirectory)
      if (m.loading) return
      setMetaFor(sessionID, { loading: true }, targetDirectory)

      try {
        const limit = options?.before ? getEffectiveMessagePageSize() : m.limit
        let page = await fetchMessagesToUserBoundary(sessionID, limit, options?.before, targetDirectory, options?.targetServerId)

        // VS Code keeps the initial page small for switch performance. Some
        // sessions have a very large final turn, so the latest 30 records can
        // contain only assistant/tool records and no user boundary. Expand only
        // this initial tail fetch, with a hard cap.
        if (!options?.before && isVSCodeRuntime() && !page.complete && !hasUserMessage(page.session)) {
          for (const nextLimit of VSCODE_INITIAL_PAGE_EXPANSION_LIMITS) {
            if (nextLimit <= limit) continue
            page = await fetchMessagesToUserBoundary(sessionID, nextLimit, undefined, targetDirectory, options?.targetServerId)
            if (page.complete || hasUserMessage(page.session)) break
          }
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
          { skipPartTypes: SKIP_PARTS, mode: options?.mode === "prepend" ? "prepend" : "merge" },
        )

        const message = Object.prototype.hasOwnProperty.call(materialized.message, sessionID)
          ? materialized.message
          : { ...materialized.message, [sessionID]: materialized.messages }
        setMetaFor(sessionID, {
          limit: materialized.messages.length,
          cursor: merged.cursor,
          complete: merged.complete,
          loading: false,
        }, targetDirectory)
        writeStore.setState({ message, part: materialized.part })
        setSessionPrefetch({
          directory: targetDirectory,
          sessionID,
          limit: materialized.messages.length,
          cursor: merged.cursor,
          complete: merged.complete,
        })
      } catch {
        setMetaFor(sessionID, { loading: false }, targetDirectory)
      }
    },
    [store, fetchMessagesToUserBoundary, getMetaFor, setMetaFor, getOptimistic, clearOptimistic, directory],
  )

  // Sync a session (load if not cached)
  const syncSession = useCallback(
    async (sessionID: string, force?: boolean) => {
      const target = resolveSessionTarget(sessionID)
      if (target.serverId === DEFAULT_SERVER_ID) {
        touch(sessionID)
      }
      const key = keyFor(sessionID, target.directory)

      // Dedup inflight requests
      const existing = inflight.current.get(key)
      if (existing) return existing

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
      if (cachedReady && hasSession && !force) return

      // Skip if recently fetched (TTL)
      if (!force && !needsVSCodeInitialTurnBoundary) {
        if (shouldSkipSessionPrefetch({
          hasMessages: cachedReady,
          info: prefetchInfo,
          pageSize: getEffectiveMessagePageSize(),
        })) return
      }

      const promise = (async () => {
        if (!hasSession || force) {
          try {
            const sessionDir = target.directory
            const client = resolveSdkForDirectory(sessionDir, sessionID, target.serverId)
            const result = await retry(() => client.session.get({ sessionID, directory: sessionDir }))
            if (result.data) {
              const s = target.store.getState()
              const sessions = [...s.session]
              const idx = Binary.search(sessions, sessionID, (s) => s.id)
              if (idx.found) {
                sessions[idx.index] = result.data
              } else {
                sessions.splice(idx.index, 0, result.data)
              }
              target.store.setState({ session: sessions })
            }
          } catch (e) {
            console.error("[sync] failed to fetch session", sessionID, e)
          }
        }

        if (!cachedReady || force) {
          await loadMessages(sessionID, {
            targetDirectory: target.directory,
            targetStore: target.store,
            targetServerId: target.serverId,
          })
        }

        if (force) {
          const sessionDir = target.directory
          const client = resolveSdkForDirectory(sessionDir, sessionID, target.serverId)
          await Promise.all([
            client.session.status({ directory: sessionDir }).then((res) => {
              if (!res.data) return
              const status = res.data[sessionID] ?? { type: "idle" as const }
              target.store.setState((s) => ({
                session_status: { ...s.session_status, [sessionID]: status },
              }))
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
      })()

      inflight.current.set(key, promise)
      promise.finally(() => inflight.current.delete(key))
      return promise
    },
    [keyFor, touch, getMetaFor, setMetaFor, loadMessages, resolveSessionTarget],
  )

  const forceRefreshSession = useCallback(
    async (sessionID: string): Promise<{ ok: boolean; error?: string }> => {
      const target = resolveSessionTarget(sessionID)
      const sessionDir = target.directory

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
        if (result.data) {
          const s = target.store.getState()
          const sessions = [...s.session]
          const idx = Binary.search(sessions, sessionID, (s) => s.id)
          if (idx.found) {
            sessions[idx.index] = result.data
          } else {
            sessions.splice(idx.index, 0, result.data)
          }
          target.store.setState({ session: sessions })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Failed to fetch session: ${msg}` }
      }

      // 4. Load messages + parts.
      try {
        await loadMessages(sessionID, {
          targetDirectory: sessionDir,
          targetStore: target.store,
          targetServerId: target.serverId,
        })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, error: `Failed to load messages: ${msg}` }
      }

      // 5. Fetch status, todos, and sub-agents in parallel.
      try {
        await Promise.all([
          client.session.status({ directory: sessionDir }).then((res) => {
            if (!res.data) return
            const status = res.data[sessionID] ?? { type: "idle" as const }
            target.store.setState((s) => ({
              session_status: { ...s.session_status, [sessionID]: status },
            }))
          }),
          client.session.todo({ sessionID, directory: sessionDir }).then((res) => {
            const todos: Todo[] | undefined = res.data && res.data.length > 0 ? res.data : undefined
            target.store.setState((s) => ({
              todo: { ...s.todo, [sessionID]: todos ?? [] },
            }))
            useTodosPersistStore.getState().setSessionTodos(sessionID, todos)
          }),
        ])
      } catch {
        // Status/todo failures are non-critical for the refresh.
      }

      return { ok: true }
    },
    [resolveSessionTarget, setMetaFor, loadMessages],
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
      await loadMessages(sessionID, {
        before: m.cursor,
        mode: "prepend",
        targetDirectory: target.directory,
        targetStore: target.store,
        targetServerId: target.serverId,
      })
    },
    [touch, getMetaFor, loadMessages, resolveSessionTarget],
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
      const result = Binary.search(messages, input.message.id, (m) => m.id)
      if (!result.found) messages.splice(result.index, 0, input.message)
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
        const result = Binary.search(next, input.messageID, (m) => m.id)
        if (result.found) {
          next.splice(result.index, 1)
          message[input.sessionID] = next
        }
      }
      delete part[input.messageID]

      targetStore.setState({ message, part })
    },
    [clearOptimistic, resolveOptimisticTarget],
  )

  return useMemo(
    () => ({
      ensureSessionRenderable: syncSession,
      syncSession,
      forceRefreshSession,
      loadMore,
      hasMore,
      isLoading,
      optimistic: {
        add: optimisticAdd,
        remove: optimisticRemove,
      },
    }),
    [syncSession, forceRefreshSession, loadMore, hasMore, isLoading, optimisticAdd, optimisticRemove],
  )
}
