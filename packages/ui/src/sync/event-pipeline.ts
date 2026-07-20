/**
 * Event Pipeline — transport connection, event coalescing, and batched flush.
 *
 * This module must not make state-dependent decisions about event validity.
 * For example, deciding whether a delta is already represented by a full part
 * snapshot belongs in the reducer, which has access to the current state.
 *
 * Plain closure API:
 *   const { cleanup } = createEventPipeline({ sdk, onEvent })
 *
 * No class, no start/stop lifecycle. One pipeline per mount.
 * Abort controller created once at init, cleaned up via returned cleanup fn.
 */

import type { Event, OpencodeClient, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { useSessionMarkersStore, normalizeSessionMarkers } from "@/stores/useSessionMarkersStore"
import { syncDebug } from "./debug"

export type QueuedEvent = {
  directory: string
  payload: Event
  serverId?: string
}

export type FlushHandler = (events: QueuedEvent[]) => void

export type EventPipelineReconnectMetadata = {
  replayGap: boolean
}

const FLUSH_FRAME_MS = 33
const BACKPRESSURE_FLUSH_FRAME_MS = 200
const BACKPRESSURE_MODE_MS = 10_000
const STREAM_YIELD_MS = 8
const DEFAULT_RECONNECT_DELAY_MS = 250
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000
const DEFAULT_WS_READY_TIMEOUT_MS = 2_000
const RETRY_BACKOFF_BASE_MS = 250
const RETRY_BACKOFF_CAP_VISIBLE_MS = 5_000
const RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS = 60_000
const RETRY_BACKOFF_MAX_EXPONENT = 8
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

export type EventPipelineInput = {
  sdk: OpencodeClient
  baseUrl?: string
  onEvent: (directory: string, payload: Event, meta?: { serverId?: string }) => void
  routeDirectory?: (directory: string, payload: Event) => string
  /** Called after stream reconnects (visibility restore or heartbeat timeout). */
  onReconnect?: (metadata: EventPipelineReconnectMetadata) => void
  /** Called when the stream disconnects (heartbeat timeout, network error, or transport failure). */
  onDisconnect?: (reason: string) => void
  transport?: "auto" | "ws" | "sse"
  heartbeatTimeoutMs?: number
  reconnectDelayMs?: number
  wsReadyTimeoutMs?: number
}

export type EventPipeline = {
  cleanup: () => void
  reconnect: (reason?: string) => void
}

type MessageStreamWsFrame = {
  type: "transport-ready" | "ready" | "disconnected" | "event" | "error" | "backpressure"
  payload?: unknown
  eventId?: string
  directory?: string
  serverId?: string
  message?: string
  reason?: string
  replayGap?: boolean
  scope?: "global" | "directory"
}

type ClosableWebSocket = WebSocket & {
  addEventListener?: WebSocket["addEventListener"]
}

function closeWebSocketWithoutPreOpenWarning(socket: ClosableWebSocket) {
  if (socket.readyState === WebSocket.CONNECTING && typeof socket.addEventListener === "function") {
    socket.addEventListener("open", () => {
      try {
        socket.close()
      } catch {
        // ignore close failures after a deferred abort
      }
    }, { once: true })
    return
  }

  try {
    socket.close()
  } catch {
    // ignore close failures during reconnect/cleanup
  }
}

const normalizeOpenChamberSessionStatus = (payload: Event): Event | null => {
  const record = payload as unknown as {
    id?: unknown
    type?: unknown
    properties?: {
      sessionID?: unknown
      sessionId?: unknown
      status?: unknown
      metadata?: {
        attempt?: unknown
        message?: unknown
        next?: unknown
      }
    }
  }

  if (record.type !== "openchamber:session-status") return null

  const sessionID = typeof record.properties?.sessionID === "string" && record.properties.sessionID.length > 0
    ? record.properties.sessionID
    : typeof record.properties?.sessionId === "string" && record.properties.sessionId.length > 0
      ? record.properties.sessionId
      : ""
  const rawStatus = typeof record.properties?.status === "string" ? record.properties.status : ""
  if (!sessionID || !rawStatus) return null

  let status: SessionStatus | null = null
  if (rawStatus === "idle" || rawStatus === "busy") {
    status = { type: rawStatus }
  } else if (rawStatus === "retry") {
    const metadata = record.properties?.metadata
    if (
      typeof metadata?.attempt === "number"
      && typeof metadata.message === "string"
      && typeof metadata.next === "number"
    ) {
      status = {
        type: "retry",
        attempt: metadata.attempt,
        message: metadata.message,
        next: metadata.next,
      }
    }
  }
  if (!status) return null

  return {
    id: typeof record.id === "string" && record.id.length > 0
      ? record.id
      : `openchamber-status-${sessionID}-${Date.now()}`,
    type: "session.status",
    properties: {
      sessionID,
      status,
    },
  } as Event
}

const normalizeOpenChamberSessionMarkers = (payload: Event): Event | null => {
  const record = payload as unknown as {
    id?: unknown
    type?: unknown
    properties?: {
      sessionId?: unknown
      sessionID?: unknown
      markers?: unknown
    }
  }

  if (record.type !== "openchamber:session-markers") return null

  const sessionID = typeof record.properties?.sessionId === "string" && record.properties.sessionId.length > 0
    ? record.properties.sessionId
    : typeof record.properties?.sessionID === "string" && record.properties.sessionID.length > 0
      ? record.properties.sessionID
      : ""
  if (!sessionID) return null

  const rawMarkers = record.properties?.markers
  if (rawMarkers === null) {
    useSessionMarkersStore.getState().applyServerUpdate(sessionID, null)
    return payload
  }
  const validated = normalizeSessionMarkers(rawMarkers)
  if (validated) {
    useSessionMarkersStore.getState().applyServerUpdate(sessionID, validated)
    return payload
  }

  return null
}

const normalizeEventType = (payload: Event): Event => {
  const normalizedOpenChamberStatus = normalizeOpenChamberSessionStatus(payload)
  if (normalizedOpenChamberStatus) {
    return normalizedOpenChamberStatus
  }

  const normalizedMarkers = normalizeOpenChamberSessionMarkers(payload)
  if (normalizedMarkers) {
    return normalizedMarkers
  }

  const type = (payload as { type?: unknown }).type
  if (typeof type !== "string") {
    return payload
  }

  const match = /^(.*)\.(\d+)$/.exec(type)
  if (!match || !match[1]) {
    return payload
  }

  return {
    ...payload,
    type: match[1] as Event["type"],
  } as unknown as Event
}

function resolveEventDirectory(event: unknown, payload: Event): string {
  const directDirectory =
    typeof event === "object" && event !== null && typeof (event as { directory?: unknown }).directory === "string"
      ? (event as { directory: string }).directory
      : null

  if (directDirectory && directDirectory.length > 0) {
    return directDirectory
  }

  const properties =
    typeof payload.properties === "object" && payload.properties !== null
      ? (payload.properties as Record<string, unknown>)
      : null
  const propertyDirectory = typeof properties?.directory === "string" ? properties.directory : null

  return propertyDirectory && propertyDirectory.length > 0 ? propertyDirectory : "global"
}

function resolveEventPayload(payload: unknown): Event | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const record = payload as { type?: unknown; payload?: unknown }
  if (typeof record.type === "string") {
    return payload as Event
  }

  if (record.payload && typeof record.payload === "object" && typeof (record.payload as { type?: unknown }).type === "string") {
    return record.payload as Event
  }

  return null
}

function resolveAbsoluteUrl(candidate: string): string {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : "/api"
  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized
  }

  if (typeof window === "undefined") {
    return normalized
  }

  const baseReference = window.location?.href || window.location?.origin
  if (!baseReference) {
    return normalized
  }

  return new URL(normalized, baseReference).toString()
}

function toWebSocketUrl(candidate: string): string {
  const url = new URL(resolveAbsoluteUrl(candidate))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function buildGlobalEventWsUrl(baseUrl: string, lastEventId?: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  const httpUrl = new URL("global/event/ws", resolveAbsoluteUrl(normalizedBase))
  if (lastEventId && lastEventId.length > 0) {
    httpUrl.searchParams.set("lastEventId", lastEventId)
  }
  return toWebSocketUrl(httpUrl.toString())
}

type DirectoryQueue = {
  queue: QueuedEvent[]
  buffer: QueuedEvent[]
  coalesced: Map<string, number>
  timer: ReturnType<typeof setTimeout> | undefined
  last: number
}

type AttemptAbortReason =
  | "pipeline_stopped"
  | `${"ws" | "sse"}_${string}`
  | null

export function createEventPipeline(input: EventPipelineInput): EventPipeline {
  const {
    sdk,
    baseUrl: inputBaseUrl,
    onEvent,
    onReconnect,
    onDisconnect,
    routeDirectory,
    transport = "auto",
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
    wsReadyTimeoutMs = DEFAULT_WS_READY_TIMEOUT_MS,
  } = input
  const baseUrl = inputBaseUrl ?? "/api"
  const abort = new AbortController()
  let disconnected = false
  let lastEventId: string | undefined

  const directories = new Map<string, DirectoryQueue>()

  const getOrCreateDir = (directory: string): DirectoryQueue => {
    let d = directories.get(directory)
    if (d) return d
    d = {
      queue: [],
      buffer: [],
      coalesced: new Map(),
      timer: undefined,
      last: 0,
    }
    directories.set(directory, d)
    return d
  }

  const key = (payload: Event): string | undefined => {
    if (payload.type === "session.status") {
      const props = payload.properties as { sessionID: string }
      return `session.status:${props.sessionID}`
    }
    if (payload.type === "session.updated") {
      const props = payload.properties as { info?: { id?: string } }
      return props.info?.id ? `session.updated:${props.info.id}` : undefined
    }
    if (payload.type === "lsp.updated") {
      return "lsp.updated"
    }
    if (payload.type === "message.part.delta") {
      const props = payload.properties as { messageID: string; partID: string; field: string }
      return `message.part.delta:${props.messageID}:${props.partID}:${props.field}`
    }
    if (payload.type === "message.part.updated") {
      const props = payload.properties as { part?: { id?: string; messageID?: string } }
      const messageID = props.part?.messageID
      const partID = props.part?.id
      if (messageID && partID) {
        return `message.part.updated:${messageID}:${partID}`
      }
    }
    return undefined
  }

  const updatedPartIdentity = (payload: Event): { messageID: string; partID: string } | null => {
    if (payload.type !== "message.part.updated") return null
    const props = payload.properties as { part?: { id?: unknown; messageID?: unknown } }
    const messageID = typeof props.part?.messageID === "string" ? props.part.messageID : ""
    const partID = typeof props.part?.id === "string" ? props.part.id : ""
    return messageID && partID ? { messageID, partID } : null
  }

  const updatedPartHasField = (payload: Event, field: string): boolean => {
    if (payload.type !== "message.part.updated") return false
    const props = payload.properties as { part?: Record<string, unknown> }
    return Object.prototype.hasOwnProperty.call(props.part || {}, field)
  }

  const hasInterveningDeltaForUpdatedPart = (d: DirectoryQueue, fromIndex: number, payload: Event): boolean => {
    const identity = updatedPartIdentity(payload)
    if (!identity) return false

    for (let index = fromIndex + 1; index < d.queue.length; index++) {
      const queued = d.queue[index]?.payload
      if (queued?.type !== "message.part.delta") continue
      const props = queued.properties as { messageID?: string; partID?: string; field?: string }
      if (
        props.messageID === identity.messageID &&
        props.partID === identity.partID &&
        typeof props.field === "string" &&
        updatedPartHasField(payload, props.field)
      ) {
        return true
      }
    }

    return false
  }

  const clearPendingDeltaCoalesceKeysForUpdatedPart = (d: DirectoryQueue, payload: Event): void => {
    const identity = updatedPartIdentity(payload)
    if (!identity) return

    const deltaPrefix = `message.part.delta:${identity.messageID}:${identity.partID}:`
    for (const coalesceKey of d.coalesced.keys()) {
      if (coalesceKey.startsWith(deltaPrefix)) {
        d.coalesced.delete(coalesceKey)
      }
    }
  }

  const flushDir = (directory: string) => {
    const d = directories.get(directory)
    if (!d) return
    if (d.timer) {
      clearTimeout(d.timer)
      d.timer = undefined
    }
    if (d.queue.length === 0) return

    const events = d.queue
    d.queue = d.buffer
    d.buffer = events
    d.queue.length = 0
    d.coalesced.clear()

    d.last = Date.now()
    syncDebug.pipeline.flush(events.length)
    for (const event of events) {
      onEvent(event.directory, event.payload, event.serverId ? { serverId: event.serverId } : undefined)
    }

    d.buffer.length = 0
  }

  const flushAll = () => {
    for (const directory of directories.keys()) {
      flushDir(directory)
    }
  }

  const scheduleDir = (directory: string) => {
    const d = getOrCreateDir(directory)
    if (d.timer) return
    const elapsed = Date.now() - d.last
    const flushFrameMs = Date.now() < backpressureUntil ? BACKPRESSURE_FLUSH_FRAME_MS : FLUSH_FRAME_MS
    d.timer = setTimeout(() => flushDir(directory), Math.max(0, flushFrameMs - elapsed))
  }

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const isAbortError = (error: unknown): boolean =>
    error instanceof DOMException && error.name === "AbortError" ||
    (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError")

  const isOffline = (): boolean =>
    typeof navigator === "object" && navigator !== null && navigator.onLine === false

  const isHidden = (): boolean =>
    typeof document !== "undefined" && document.visibilityState !== "visible"

  const extractStatus = (error: unknown): number | undefined => {
    if (!error || typeof error !== "object") return undefined
    const direct = (error as { status?: unknown }).status
    if (typeof direct === "number") return direct
    const fromResponse = (error as { response?: { status?: unknown } }).response?.status
    if (typeof fromResponse === "number") return fromResponse
    return undefined
  }

  const isPermanentHttpStatus = (status: number): boolean => {
    if (status < 400 || status >= 500) return false
    if (status === 408 || status === 429) return false
    return true
  }

  const waitForRetry = (ms: number) => new Promise<void>((resolve) => {
    if (ms <= 0 || abort.signal.aborted) {
      resolve()
      return
    }

    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (typeof globalThis.window !== "undefined") {
        globalThis.window.removeEventListener("online", onInterrupt)
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityInterrupt)
      }
      abort.signal.removeEventListener("abort", onInterrupt)
    }
    const onInterrupt = () => {
      cleanup()
      resolve()
    }
    const onVisibilityInterrupt = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        onInterrupt()
      }
    }

    timer = setTimeout(onInterrupt, ms)
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.addEventListener("online", onInterrupt, { once: true })
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityInterrupt)
    }
    abort.signal.addEventListener("abort", onInterrupt, { once: true })
  })

  const computeRetryDelay = (failures: number): number => {
    if (failures <= 0) return 0
    if (isOffline()) return RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS
    const cap = isHidden() ? RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS : RETRY_BACKOFF_CAP_VISIBLE_MS
    const exponent = Math.min(failures - 1, RETRY_BACKOFF_MAX_EXPONENT)
    return Math.min(cap, RETRY_BACKOFF_BASE_MS * 2 ** exponent)
  }

  let streamErrorLogged = false
  let attempt: AbortController | undefined
  let lastEventAt = Date.now()
  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let activeTransport: "ws" | "sse" = transport === "ws" ? "ws" : "sse"
  let attemptAbortReason: AttemptAbortReason = null
  let consecutiveFailures = 0
  let backpressureUntil = 0

  const notifyDisconnected = (reason: string) => {
    if (disconnected) {
      return
    }
    disconnected = true
    onDisconnect?.(reason)
  }

  const markConnected = (replayGap = false) => {
    disconnected = false
    consecutiveFailures = 0
    // Fire onReconnect on every successful connect — including the very
    // first one. Consumer state (isConnected) starts at false and needs
    // to be flipped positively; without this the send button throws
    // "Connection lost" until something else (HTTP health check) happens
    // to race a setState({isConnected: true}) through.
    onReconnect?.({ replayGap })
  }

  const enqueueEvent = (directory: string, payload: Event, serverId?: string) => {
    const normalizedPayload = normalizeEventType(payload)
    const routedDirectory = serverId ? directory : (routeDirectory?.(directory, normalizedPayload) || directory)
    const d = getOrCreateDir(routedDirectory)
    if (normalizedPayload.type === "message.part.updated") {
      clearPendingDeltaCoalesceKeysForUpdatedPart(d, normalizedPayload)
    }
    const k = key(normalizedPayload)
    const nextEvent: QueuedEvent = {
      directory: routedDirectory,
      payload: normalizedPayload,
      ...(serverId ? { serverId } : {}),
    }
    if (k) {
      const i = d.coalesced.get(k)
      if (i !== undefined) {
        if (normalizedPayload.type === "message.part.updated" && hasInterveningDeltaForUpdatedPart(d, i, normalizedPayload)) {
          d.coalesced.set(k, d.queue.length)
          d.queue.push(nextEvent)
          scheduleDir(routedDirectory)
          return
        }
        if (normalizedPayload.type === "message.part.delta") {
          const prev = d.queue[i]?.payload as unknown as { properties: { delta: string } } | undefined
          const inc = normalizedPayload.properties as { delta: string }
          d.queue[i] = {
            ...nextEvent,
            payload: {
              ...normalizedPayload,
              properties: {
                ...(normalizedPayload.properties as object),
                delta: (prev?.properties.delta ?? "") + inc.delta,
              },
            } as unknown as Event,
          }
        } else {
          d.queue[i] = nextEvent
        }
        syncDebug.pipeline.coalesced(normalizedPayload.type, k)
        return
      }
      d.coalesced.set(k, d.queue.length)
    }

    d.queue.push(nextEvent)
    scheduleDir(routedDirectory)
  }

  const resetHeartbeat = () => {
    lastEventAt = Date.now()
    if (heartbeat) clearTimeout(heartbeat)
    heartbeat = setTimeout(() => {
      attemptAbortReason = `${activeTransport}_heartbeat_timeout`
      attempt?.abort()
    }, heartbeatTimeoutMs)
  }

  const clearHeartbeat = () => {
    if (!heartbeat) return
    clearTimeout(heartbeat)
    heartbeat = undefined
  }

  const runSseAttempt = async (signal: AbortSignal) => {
    const events = await sdk.global.event({
      signal,
      ...(lastEventId && lastEventId.length > 0 ? { headers: { "Last-Event-ID": lastEventId } } : {}),
      onSseEvent: (event: { id?: unknown }) => {
        resetHeartbeat()
        if (typeof event.id === "string" && event.id.length > 0) {
          lastEventId = event.id
        }
      },
      onSseError: (error: unknown) => {
        if (isAbortError(error)) return
        if (streamErrorLogged) return
        streamErrorLogged = true
        console.error("[event-pipeline] SSE stream error", error)
      },
    })

    markConnected()

    let yielded = Date.now()
    resetHeartbeat()

    for await (const event of events.stream) {
      resetHeartbeat()
      streamErrorLogged = false

      const payload = resolveEventPayload((event as { payload?: Event }).payload ?? event)
      if (!payload) {
        continue
      }
      const directory = resolveEventDirectory(event, payload)
      enqueueEvent(directory, payload)

      if (Date.now() - yielded < STREAM_YIELD_MS) continue
      yielded = Date.now()
      await wait(0)
    }
  }

  const runWsAttempt = async (signal: AbortSignal) => {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let opened = false
      let readyAt = 0
      const socket = new WebSocket(buildGlobalEventWsUrl(baseUrl, lastEventId)) as ClosableWebSocket

      let readyTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
        readyTimer = undefined
        const error = new Error("Message stream WebSocket ready timeout")
        settleReject(error)
        closeWebSocketWithoutPreOpenWarning(socket)
      }, wsReadyTimeoutMs)

      const cleanup = () => {
        if (readyTimer) {
          clearTimeout(readyTimer)
          readyTimer = undefined
        }
        socket.onopen = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
      }

      const settleResolve = () => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", handleAbort)
        cleanup()
        resolve()
      }

      const settleReject = (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener("abort", handleAbort)
        cleanup()
        reject(error)
      }

      const handleAbort = () => {
        closeWebSocketWithoutPreOpenWarning(socket)
        settleResolve()
      }

      signal.addEventListener("abort", handleAbort, { once: true })

      socket.onopen = () => {
        // Don't clear streamErrorLogged here. If the socket immediately closes
        // before sending the ready frame, clearing would cause log spam.
      }

      socket.onmessage = (messageEvent) => {
        resetHeartbeat()
        streamErrorLogged = false

        let frame: MessageStreamWsFrame | null = null
        try {
          frame = JSON.parse(String(messageEvent.data)) as MessageStreamWsFrame
        } catch (error) {
          console.warn("[event-pipeline] Failed to parse WS frame", error)
          return
        }

        if (!frame || typeof frame.type !== "string") {
          return
        }

        if (frame.type === "transport-ready") {
          if (readyTimer) {
            clearTimeout(readyTimer)
            readyTimer = undefined
          }
          streamErrorLogged = false
          return
        }

        if (frame.type === "ready") {
          opened = true
          readyAt = Date.now()
          if (readyTimer) {
            clearTimeout(readyTimer)
            readyTimer = undefined
          }
          streamErrorLogged = false
          markConnected(frame.replayGap === true)
          return
        }

        if (frame.type === "disconnected") {
          notifyDisconnected(frame.reason || "upstream_disconnected")
          return
        }

        if (frame.type === "error") {
          const error = new Error(frame.message || "Message stream WebSocket error")
          ;(error as Error & { reason?: string }).reason = `ws_error_frame:${frame.message || "unknown"}`
          settleReject(error)
          closeWebSocketWithoutPreOpenWarning(socket)
          return
        }

        if (frame.type === "backpressure") {
          backpressureUntil = Date.now() + BACKPRESSURE_MODE_MS
          return
        }

        if (frame.type !== "event") {
          return
        }

        const payload = resolveEventPayload(frame.payload)
        if (!payload) {
          return
        }

        if (typeof frame.eventId === "string" && frame.eventId.length > 0) {
          lastEventId = frame.eventId
        }

        const directory = resolveEventDirectory(
          { directory: frame.directory, payload },
          payload,
        )
        const serverId = typeof frame.serverId === "string" && frame.serverId.length > 0
          ? frame.serverId
          : undefined
        enqueueEvent(directory, payload, serverId)
      }

      socket.onerror = () => {
        void 0
      }

      socket.onclose = (event) => {
        if (signal.aborted) {
          settleResolve()
          return
        }

        const error = new Error("Global message stream WebSocket closed")
        ;(error as Error & { reason?: string }).reason = opened
          ? `ws_closed:code=${event?.code ?? "?"}`
          : "ws_closed_before_ready"

        const livedMs = readyAt > 0 ? Date.now() - readyAt : 0
        const unstableAfterReady = opened && livedMs > 0 && livedMs < 2_000
        const closeCode = typeof event?.code === "number" ? event.code : undefined
        const abnormalClose = opened && closeCode !== 1000 && closeCode !== 1001
        if (unstableAfterReady || abnormalClose) {
          ;(error as Error & { reason?: string }).reason = `ws_unstable_close:code=${closeCode ?? "?"}`
        }
        settleReject(error)
      }
    })
  }

  const resolveTransport = (): "ws" | "sse" => {
    if (typeof WebSocket !== "function") {
      return "sse"
    }
    if (transport === "ws") {
      return "ws"
    }
    if (transport === "sse") {
      return "sse"
    }
    return "ws"
  }

  void (async () => {
    while (!abort.signal.aborted) {
      attempt = new AbortController()
      lastEventAt = Date.now()
      attemptAbortReason = null
      let retryDelayMs = reconnectDelayMs
      const currentTransport = resolveTransport()
      activeTransport = currentTransport
      const onAbort = () => {
        attemptAbortReason = "pipeline_stopped"
        attempt?.abort()
      }
      abort.signal.addEventListener("abort", onAbort)

      try {
        if (currentTransport === "ws") {
          await runWsAttempt(attempt.signal)
        } else {
          await runSseAttempt(attempt.signal)
        }
      } catch (error) {
        if (!isAbortError(error)) {
          consecutiveFailures += 1
          if (!streamErrorLogged) {
            streamErrorLogged = true
            console.error("[event-pipeline] stream failed", error)
          }
          // Notify consumer that the stream has disconnected, so it can
          // update connection state (e.g. set isConnected = false).
          // Guard: only fire once per disconnection cycle to avoid repeated
          // setState calls on every failed retry attempt.
          const taggedReason = typeof error === "object" && error !== null
            ? (error as { reason?: unknown }).reason
            : undefined
          const message = typeof error === "object" && error !== null
            ? (error as { message?: unknown }).message
            : undefined
          const reason = typeof taggedReason === "string" && taggedReason.length > 0
            ? taggedReason
            : typeof message === "string" && message.length > 0
              ? `${currentTransport}_error:${message.slice(0, 80)}`
              : `${currentTransport}_error:unknown`
          notifyDisconnected(reason)

          const status = extractStatus(error)
          if (status !== undefined && isPermanentHttpStatus(status)) {
            retryDelayMs = RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS
          } else {
            retryDelayMs = computeRetryDelay(consecutiveFailures)
          }
        }
      } finally {
        abort.signal.removeEventListener("abort", onAbort)
        attempt = undefined
        clearHeartbeat()
      }

      if (abort.signal.aborted) return
      if (attemptAbortReason && attemptAbortReason !== "pipeline_stopped") {
        notifyDisconnected(attemptAbortReason)
        retryDelayMs = 0
        attemptAbortReason = null
      }
      if (retryDelayMs > 0) {
        await waitForRetry(retryDelayMs)
      }
    }
  })().finally(flushAll)

  const onVisibility = () => {
    if (typeof document === "undefined") return
    if (document.visibilityState !== "visible") return
    if (Date.now() - lastEventAt < heartbeatTimeoutMs) return
    attempt?.abort()
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    attempt?.abort()
  }

  // OS wake-from-sleep (Electron powerMonitor.resume). The SSE connection
  // is almost certainly dead after sleep — abort immediately so the
  // reconnect loop fires on the next tick with retryDelayMs = 0.
  const onSystemResume = () => {
    attemptAbortReason = `${activeTransport}_system_resume`
    attempt?.abort()
  }

  const onOnline = () => {
    if (!disconnected) return
    attempt?.abort()
  }

  const onOffline = () => {
    attempt?.abort()
  }

  const reconnect = (reason = "manual") => {
    attemptAbortReason = `${activeTransport}_${reason}`
    attempt?.abort()
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pageshow", onPageShow)
  }

  // Use globalThis (not window) for the system-resume listener so that
  // test environments can replace globalThis.window with a stub.
  if (typeof globalThis.window !== "undefined") {
    globalThis.window.addEventListener("openchamber:system-resume", onSystemResume)
    globalThis.window.addEventListener("online", onOnline)
    globalThis.window.addEventListener("offline", onOffline)
  }

  const cleanup = () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pageshow", onPageShow)
    }
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.removeEventListener("openchamber:system-resume", onSystemResume)
      globalThis.window.removeEventListener("online", onOnline)
      globalThis.window.removeEventListener("offline", onOffline)
    }
    abort.abort()
    flushAll()
  }

  return { cleanup, reconnect }
}
