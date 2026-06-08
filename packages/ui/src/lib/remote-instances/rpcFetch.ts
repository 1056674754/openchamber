const REMOTE_RPC_WS_PATH = "/api/remote-rpc/ws"
const REMOTE_RPC_GLOBAL_KEY = "__openchamber_remote_rpc_fetch__"
const LOCAL_RPC_TARGET = "local"
const REMOTE_RPC_DEBUG_STORAGE_KEY = "openchamber_remote_rpc_debug"
const REMOTE_RPC_DEBUG_BODY_STORAGE_KEY = "openchamber_remote_rpc_debug_body"
const REMOTE_RPC_DEBUG_EVENT = "openchamber:remote-rpc"
const REMOTE_RPC_DEBUG_MAX_ENTRIES = 600
const REMOTE_RPC_DEBUG_BODY_PREVIEW_BYTES = 4096

type RemoteRpcRequestFrame = {
  type: "request"
  id: string
  target?: typeof LOCAL_RPC_TARGET | "remote"
  instanceId?: string
  method: string
  path: string
  headers: Record<string, string>
  bodyBase64?: string
}

type RemoteRpcResponseFrame = {
  type: "response"
  id: string
  target?: typeof LOCAL_RPC_TARGET | "remote"
  instanceId?: string
  path?: string
  status: number
  statusText?: string
  headers?: Record<string, string>
  bodyBase64?: string
}

type PendingRequest = {
  resolve: (response: Response) => void
  reject: (error: unknown) => void
  abortListener?: () => void
  signal?: AbortSignal | null
  debug: RemoteRpcDebugRequest
}

type RemoteRpcFetchState = {
  installed: boolean
  nativeFetch: typeof fetch
  socket: WebSocket | null
  opening: Promise<WebSocket> | null
  pending: Map<string, PendingRequest>
  nextId: number
}

type RemoteRpcGlobal = typeof globalThis & {
  [REMOTE_RPC_GLOBAL_KEY]?: RemoteRpcFetchState
}

type RemoteRpcTarget = {
  target: typeof LOCAL_RPC_TARGET | "remote"
  instanceId?: string
  path: string
}

type RemoteRpcDebugRequest = {
  id: string
  target: typeof LOCAL_RPC_TARGET | "remote"
  instanceId?: string
  method: string
  path: string
  startedAt: number
  requestBodyBytes?: number
  requestBodyPreview?: string
  requestBodyTruncated?: boolean
  stack?: string
}

type RemoteRpcDebugEntry = Omit<RemoteRpcDebugRequest, "startedAt"> & {
  phase: "request" | "response" | "abort" | "error"
  at: string
  elapsedMs?: number
  status?: number
  statusText?: string
  responseBodyBytes?: number
  responseBodyPreview?: string
  responseBodyTruncated?: boolean
  error?: string
  beforeSend?: boolean
}

type RemoteRpcDebugApi = {
  entries: RemoteRpcDebugEntry[]
  enabled: () => boolean
  bodyEnabled: () => boolean
  enable: () => void
  disable: () => void
  enableBody: () => void
  disableBody: () => void
  clear: () => void
  snapshot: (options?: { pathIncludes?: string; status?: number; phase?: RemoteRpcDebugEntry["phase"] }) => RemoteRpcDebugEntry[]
  pending: () => Array<{
    id: string
    target: typeof LOCAL_RPC_TARGET | "remote"
    instanceId?: string
    method: string
    path: string
    elapsedMs: number
  }>
}

type RemoteRpcDebugWindow = Window & {
  __openchamberRemoteRpcDebug?: RemoteRpcDebugApi
}

const isBrowserRuntime = (): boolean =>
  typeof globalThis.window !== "undefined"
  && typeof globalThis.WebSocket === "function"
  && typeof globalThis.fetch === "function"

const getWindow = (): RemoteRpcDebugWindow | null => (
  typeof globalThis.window === "undefined"
    ? null
    : globalThis.window as RemoteRpcDebugWindow
)

const getStorageFlag = (key: string): boolean => {
  try {
    return getWindow()?.localStorage?.getItem(key) === "1"
  } catch {
    return false
  }
}

const setStorageFlag = (key: string, enabled: boolean): void => {
  try {
    const storage = getWindow()?.localStorage
    if (!storage) return
    if (enabled) {
      storage.setItem(key, "1")
    } else {
      storage.removeItem(key)
    }
  } catch {
    // Debug helpers should never affect request behavior.
  }
}

const ensureDebugApi = (state?: RemoteRpcFetchState | null): RemoteRpcDebugApi | null => {
  const win = getWindow()
  if (!win) return null
  if (!win.__openchamberRemoteRpcDebug) {
    const entries: RemoteRpcDebugEntry[] = []
    win.__openchamberRemoteRpcDebug = {
      entries,
      enabled: () => getStorageFlag(REMOTE_RPC_DEBUG_STORAGE_KEY),
      bodyEnabled: () => getStorageFlag(REMOTE_RPC_DEBUG_BODY_STORAGE_KEY),
      enable: () => setStorageFlag(REMOTE_RPC_DEBUG_STORAGE_KEY, true),
      disable: () => setStorageFlag(REMOTE_RPC_DEBUG_STORAGE_KEY, false),
      enableBody: () => setStorageFlag(REMOTE_RPC_DEBUG_BODY_STORAGE_KEY, true),
      disableBody: () => setStorageFlag(REMOTE_RPC_DEBUG_BODY_STORAGE_KEY, false),
      clear: () => {
        entries.length = 0
      },
      snapshot: (options = {}) => entries.filter((entry) => {
        if (options.phase && entry.phase !== options.phase) return false
        if (typeof options.status === "number" && entry.status !== options.status) return false
        if (options.pathIncludes && !entry.path.includes(options.pathIncludes)) return false
        return true
      }),
      pending: () => Array.from(state?.pending.entries() ?? []).map(([, pending]) => ({
        id: pending.debug.id,
        target: pending.debug.target,
        instanceId: pending.debug.instanceId,
        method: pending.debug.method,
        path: pending.debug.path,
        elapsedMs: Math.max(0, Math.round(performance.now() - pending.debug.startedAt)),
      })),
    }
  }
  return win.__openchamberRemoteRpcDebug
}

const maybeDispatchDebugEvent = (entry: RemoteRpcDebugEntry): void => {
  try {
    const win = getWindow()
    if (win && typeof win.dispatchEvent === "function" && typeof CustomEvent === "function") {
      win.dispatchEvent(new CustomEvent(REMOTE_RPC_DEBUG_EVENT, { detail: entry }))
    }
  } catch {
    // Ignore debug event failures.
  }
}

const pushDebugEntry = (state: RemoteRpcFetchState, entry: RemoteRpcDebugEntry): void => {
  const api = ensureDebugApi(state)
  if (!api) return
  api.entries.push(entry)
  if (api.entries.length > REMOTE_RPC_DEBUG_MAX_ENTRIES) {
    api.entries.splice(0, api.entries.length - REMOTE_RPC_DEBUG_MAX_ENTRIES)
  }
  maybeDispatchDebugEvent(entry)
  if (api.enabled()) {
    console.debug(`[remote-rpc] ${entry.phase}`, entry)
  }
}

const decodeBytesPreview = (bytes: Uint8Array, maxBytes = REMOTE_RPC_DEBUG_BODY_PREVIEW_BYTES): {
  preview?: string
  truncated?: boolean
} => {
  if (bytes.byteLength === 0) {
    return {}
  }
  try {
    const slice = bytes.byteLength > maxBytes ? bytes.slice(0, maxBytes) : bytes
    return {
      preview: new TextDecoder().decode(slice),
      truncated: bytes.byteLength > maxBytes,
    }
  } catch {
    return {
      preview: `<${bytes.byteLength} bytes>`,
      truncated: bytes.byteLength > maxBytes,
    }
  }
}

const summarizeRequestFrame = (state: RemoteRpcFetchState, frame: RemoteRpcRequestFrame, startedAt: number): RemoteRpcDebugRequest => {
  const debug: RemoteRpcDebugRequest = {
    id: frame.id,
    target: frame.target ?? "remote",
    instanceId: frame.instanceId,
    method: frame.method,
    path: frame.path,
    startedAt,
  }
  if (frame.bodyBase64) {
    const body = decodeBase64(frame.bodyBase64)
    debug.requestBodyBytes = body.byteLength
    if (ensureDebugApi(state)?.bodyEnabled()) {
      const preview = decodeBytesPreview(body)
      debug.requestBodyPreview = preview.preview
      debug.requestBodyTruncated = preview.truncated
    }
  }
  return debug
}

const attachCallerStack = (debug: RemoteRpcDebugRequest, callerStack?: string): RemoteRpcDebugRequest => {
  if (!callerStack) {
    return debug
  }
  debug.stack = callerStack
  return debug
}

const debugBaseEntry = (debug: RemoteRpcDebugRequest, phase: RemoteRpcDebugEntry["phase"]): RemoteRpcDebugEntry => ({
  id: debug.id,
  target: debug.target,
  instanceId: debug.instanceId,
  method: debug.method,
  path: debug.path,
  requestBodyBytes: debug.requestBodyBytes,
  requestBodyPreview: debug.requestBodyPreview,
  requestBodyTruncated: debug.requestBodyTruncated,
  stack: debug.stack,
  phase,
  at: new Date().toISOString(),
  elapsedMs: Math.max(0, Math.round(performance.now() - debug.startedAt)),
})

const augmentResponseHeaders = (headers: Record<string, string> | undefined, debug: RemoteRpcDebugRequest, elapsedMs: number): Headers => {
  const result = new Headers(headers)
  result.set("x-openchamber-rpc-id", debug.id)
  result.set("x-openchamber-rpc-target", debug.target)
  result.set("x-openchamber-rpc-method", debug.method)
  result.set("x-openchamber-rpc-path", debug.path)
  result.set("x-openchamber-rpc-elapsed-ms", String(elapsedMs))
  if (debug.instanceId) {
    result.set("x-openchamber-rpc-instance-id", debug.instanceId)
  }
  return result
}

const getState = (): RemoteRpcFetchState | null => {
  if (!isBrowserRuntime()) {
    return null
  }

  const root = globalThis as RemoteRpcGlobal
  if (!root[REMOTE_RPC_GLOBAL_KEY]) {
    root[REMOTE_RPC_GLOBAL_KEY] = {
      installed: false,
      nativeFetch: globalThis.fetch.bind(globalThis),
      socket: null,
      opening: null,
      pending: new Map(),
      nextId: 1,
    }
  }
  ensureDebugApi(root[REMOTE_RPC_GLOBAL_KEY])
  return root[REMOTE_RPC_GLOBAL_KEY]
}

const toAbsoluteUrl = (input: RequestInfo | URL): string => {
  if (input instanceof Request) {
    return input.url
  }
  return new URL(String(input), globalThis.window.location.href).toString()
}

const isRpcExcludedApiPath = (pathname: string): boolean => (
  pathname === REMOTE_RPC_WS_PATH
  || pathname === "/api/global/event"
  || pathname === "/api/event"
  || pathname === "/api/global/event/ws"
  || pathname === "/api/event/ws"
)

const resolveRpcTarget = (url: string): RemoteRpcTarget | null => {
  let parsed: URL
  try {
    parsed = new URL(url, globalThis.window.location.href)
  } catch {
    return null
  }

  if (parsed.origin !== globalThis.window.location.origin) {
    return null
  }

  const match = /^\/api\/remote\/([^/]+)(\/.*)?$/.exec(parsed.pathname)
  if (match?.[1]) {
    let instanceId = ""
    try {
      instanceId = decodeURIComponent(match[1])
    } catch {
      return null
    }
    if (!instanceId) {
      return null
    }

    const suffix = match[2] || ""
    const remotePath = `/api${suffix}${parsed.search}`

    try {
      const remoteUrl = new URL(remotePath, globalThis.window.location.origin)
      if (isRpcExcludedApiPath(remoteUrl.pathname)) {
        return null
      }
    } catch {
      return null
    }

    return {
      target: "remote",
      instanceId,
      path: remotePath,
    }
  }

  if (parsed.pathname.startsWith("/api/") && !isRpcExcludedApiPath(parsed.pathname)) {
    return {
      target: LOCAL_RPC_TARGET,
      path: `${parsed.pathname}${parsed.search}`,
    }
  }

  return null
}

const buildRemoteRpcWsUrl = (): string => {
  const url = new URL(REMOTE_RPC_WS_PATH, globalThis.window.location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

const rejectPending = (state: RemoteRpcFetchState, error: unknown) => {
  for (const [id, pending] of Array.from(state.pending.entries())) {
    state.pending.delete(id)
    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener("abort", pending.abortListener)
    }
    pending.reject(error)
  }
}

const ensureSocket = (state: RemoteRpcFetchState): Promise<WebSocket> => {
  if (state.socket?.readyState === globalThis.WebSocket.OPEN) {
    return Promise.resolve(state.socket)
  }

  if (state.opening) {
    return state.opening
  }

  state.opening = new Promise<WebSocket>((resolve, reject) => {
    const socket = new globalThis.WebSocket(buildRemoteRpcWsUrl())
    state.socket = socket

    const cleanupOpening = () => {
      if (state.opening) {
        state.opening = null
      }
    }

    socket.onopen = () => {
      cleanupOpening()
      resolve(socket)
    }

    socket.onmessage = (event) => {
      let frame: RemoteRpcResponseFrame | null = null
      try {
        frame = JSON.parse(String(event.data)) as RemoteRpcResponseFrame
      } catch {
        return
      }

      if (frame?.type !== "response" || typeof frame.id !== "string") {
        return
      }

      const pending = state.pending.get(frame.id)
      if (!pending) {
        return
      }

      state.pending.delete(frame.id)
      if (pending.abortListener && pending.signal) {
        pending.signal.removeEventListener("abort", pending.abortListener)
      }

      const bytes = decodeBase64(frame.bodyBase64 || "")
      const status = Number.isInteger(frame.status) && frame.status >= 200 && frame.status <= 599
        ? frame.status
        : 502
      const elapsedMs = Math.max(0, Math.round(performance.now() - pending.debug.startedAt))
      const responsePreviewEnabled = status >= 400 || ensureDebugApi(state)?.bodyEnabled() === true
      const responsePreview = responsePreviewEnabled ? decodeBytesPreview(bytes) : {}
      pushDebugEntry(state, {
        ...debugBaseEntry(pending.debug, "response"),
        elapsedMs,
        status,
        statusText: frame.statusText || "",
        responseBodyBytes: bytes.byteLength,
        responseBodyPreview: responsePreview.preview,
        responseBodyTruncated: responsePreview.truncated,
      })
      pending.resolve(new Response(bytes, {
        status,
        statusText: frame.statusText || "",
        headers: augmentResponseHeaders(frame.headers, pending.debug, elapsedMs),
      }))
    }

    socket.onerror = () => {
      cleanupOpening()
      reject(new Error("Remote RPC WebSocket failed"))
    }

    socket.onclose = () => {
      cleanupOpening()
      if (state.socket === socket) {
        state.socket = null
      }
      rejectPending(state, new Error("Remote RPC WebSocket closed"))
    }
  })

  return state.opening
}

const encodeBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

const decodeBase64 = (value: string): Uint8Array => {
  if (!value) {
    return new Uint8Array()
  }
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const createAbortError = (): Error => {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError") as unknown as Error
  }
  const error = new Error("The operation was aborted.")
  error.name = "AbortError"
  return error
}

const buildRequest = (input: RequestInfo | URL, init?: RequestInit): Request => {
  if (input instanceof Request) {
    return new Request(input, init)
  }
  return new Request(toAbsoluteUrl(input), init)
}

const headersToRecord = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

const buildRequestFrame = async (
  request: Request,
  target: RemoteRpcTarget,
  id: string,
): Promise<RemoteRpcRequestFrame> => {
  const frame: RemoteRpcRequestFrame = {
    type: "request",
    id,
    target: target.target,
    instanceId: target.instanceId,
    method: request.method || "GET",
    path: target.path,
    headers: headersToRecord(request.headers),
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const body = await request.arrayBuffer()
    if (body.byteLength > 0) {
      frame.bodyBase64 = encodeBase64(body)
    }
  }

  return frame
}

const sendRemoteRpcFetch = async (
  state: RemoteRpcFetchState,
  request: Request,
  target: RemoteRpcTarget,
  callerStack?: string,
): Promise<Response> => {
  if (request.signal.aborted) {
    throw createAbortError()
  }

  const id = `rpc_${Date.now().toString(36)}_${(state.nextId++).toString(36)}`
  const frame = await buildRequestFrame(request, target, id)
  const debug = attachCallerStack(summarizeRequestFrame(state, frame, performance.now()), callerStack)
  let socket: WebSocket
  try {
    socket = await ensureSocket(state)
  } catch (error) {
    pushDebugEntry(state, {
      ...debugBaseEntry(debug, "error"),
      error: error instanceof Error ? error.message : String(error),
      beforeSend: true,
    })
    if (error && typeof error === "object") {
      ;(error as Error & { remoteRpcBeforeSend?: boolean }).remoteRpcBeforeSend = true
    }
    throw error
  }

  return new Promise<Response>((resolve, reject) => {
    const pending: PendingRequest = { resolve, reject, signal: request.signal, debug }
    const abortListener = () => {
      state.pending.delete(id)
      try {
        socket.send(JSON.stringify({ type: "cancel", id }))
      } catch {
        void 0
      }
      pushDebugEntry(state, {
        ...debugBaseEntry(debug, "abort"),
        error: "AbortError",
      })
      reject(createAbortError())
    }
    pending.abortListener = abortListener
    request.signal.addEventListener("abort", abortListener, { once: true })
    state.pending.set(id, pending)

    try {
      pushDebugEntry(state, debugBaseEntry(debug, "request"))
      socket.send(JSON.stringify(frame))
    } catch (error) {
      state.pending.delete(id)
      request.signal.removeEventListener("abort", abortListener)
      pushDebugEntry(state, {
        ...debugBaseEntry(debug, "error"),
        error: error instanceof Error ? error.message : String(error),
      })
      reject(error)
    }
  })
}

export function installRemoteRpcFetchBridge(): void {
  const state = getState()
  if (!state || state.installed) {
    return
  }

  const nativeFetch = state.nativeFetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let target: RemoteRpcTarget | null = null
    let request: Request | null = null

    try {
      const url = toAbsoluteUrl(input)
      target = resolveRpcTarget(url)
      if (!target || !target.path) {
        return nativeFetch(input, init)
      }
      request = buildRequest(input, init)
    } catch {
      return nativeFetch(input, init)
    }

    try {
      return await sendRemoteRpcFetch(state, request, target, new Error("remote RPC fetch caller").stack)
    } catch (error) {
      if (error && typeof error === "object" && (error as Error).name === "AbortError") {
        throw error
      }
      if (error && typeof error === "object" && (error as Error & { remoteRpcBeforeSend?: boolean }).remoteRpcBeforeSend === true) {
        return nativeFetch(input, init)
      }
      throw error
    }
  }) as typeof fetch

  state.installed = true
}

installRemoteRpcFetchBridge()
