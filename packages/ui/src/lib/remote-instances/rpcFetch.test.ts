import { beforeEach, describe, expect, test } from "bun:test"
import { installRemoteRpcFetchBridge } from "./rpcFetch"

const REMOTE_RPC_GLOBAL_KEY = "__openchamber_remote_rpc_fetch__"

const originalWindow = globalThis.window
const originalWebSocket = globalThis.WebSocket
const originalFetch = globalThis.fetch

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.CONNECTING
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(payload: string) {
    const frame = JSON.parse(payload)
    this.sent.push(frame)
    if (frame.type === "request") {
      this.onmessage?.({
        data: JSON.stringify({
          type: "response",
          id: frame.id,
          status: 200,
          statusText: "OK",
          headers: { "content-type": "application/json" },
          bodyBase64: btoa(JSON.stringify({ ok: true })),
        }),
      })
    }
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

const installBrowserStubs = () => {
  ;(globalThis as unknown as { window: unknown }).window = {
    location: {
      href: "http://127.0.0.1:3000/",
      origin: "http://127.0.0.1:3000",
    },
  }
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket
}

const cleanup = () => {
  ;(globalThis as unknown as { window: unknown }).window = originalWindow
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket
  globalThis.fetch = originalFetch
  delete (globalThis as typeof globalThis & { [REMOTE_RPC_GLOBAL_KEY]?: unknown })[REMOTE_RPC_GLOBAL_KEY]
  FakeWebSocket.instances = []
}

beforeEach(cleanup)

describe("remote RPC fetch bridge", () => {
  test("routes /api/remote/:id fetches over the remote RPC websocket", async () => {
    installBrowserStubs()
    globalThis.fetch = (async () => new Response("native")) as typeof fetch
    delete (globalThis as typeof globalThis & { [REMOTE_RPC_GLOBAL_KEY]?: unknown })[REMOTE_RPC_GLOBAL_KEY]
    installRemoteRpcFetchBridge()

    const cases: Array<{
      input: string
      init?: RequestInit
      method: string
      path: string
      body?: unknown
    }> = [
      {
        input: "/api/remote/remote-a/fs/list?path=%2Ftmp",
        method: "GET",
        path: "/api/fs/list?path=%2Ftmp",
      },
      {
        input: "/api/remote/remote-a/session/status?directory=%2Ftmp",
        method: "GET",
        path: "/api/session/status?directory=%2Ftmp",
      },
      {
        input: "/api/remote/remote-a/fs/exec",
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands: ["pwd"], cwd: "/tmp", background: false }),
        },
        method: "POST",
        path: "/api/fs/exec",
        body: { commands: ["pwd"], cwd: "/tmp", background: false },
      },
      {
        input: "/api/remote/remote-a/git/worktrees?directory=%2Ftmp",
        method: "GET",
        path: "/api/git/worktrees?directory=%2Ftmp",
      },
      {
        input: "/api/remote/remote-a/experimental/session?directory=%2Ftmp&limit=200",
        method: "GET",
        path: "/api/experimental/session?directory=%2Ftmp&limit=200",
      },
    ]

    let socket: FakeWebSocket | undefined
    for (const [index, testCase] of cases.entries()) {
      const responsePromise = globalThis.fetch(testCase.input, testCase.init)
      await Promise.resolve()
      socket = socket ?? FakeWebSocket.instances[0]
      if (index === 0) {
        expect(socket?.url).toBe("ws://127.0.0.1:3000/api/remote-rpc/ws")
        socket?.emitOpen()
      }

      const response = await responsePromise
      expect(response.ok).toBe(true)
      expect(await response.json()).toEqual({ ok: true })
      expect(socket?.sent).toHaveLength(index + 1)
      const frame = socket?.sent[index] as {
        type?: unknown
        target?: unknown
        instanceId?: unknown
        method?: unknown
        path?: unknown
        bodyBase64?: unknown
      }
      expect(frame.type).toBe("request")
      expect(frame.target).toBe("remote")
      expect(frame.instanceId).toBe("remote-a")
      expect(frame.method).toBe(testCase.method)
      expect(frame.path).toBe(testCase.path)
      if (testCase.body) {
        expect(JSON.parse(atob(String(frame.bodyBase64)))).toEqual(testCase.body)
      }
    }
  })

  test("routes local /api fetches over the remote RPC websocket", async () => {
    installBrowserStubs()
    let nativeCalled = false
    globalThis.fetch = (async () => {
      nativeCalled = true
      return new Response("native")
    }) as typeof fetch
    delete (globalThis as typeof globalThis & { [REMOTE_RPC_GLOBAL_KEY]?: unknown })[REMOTE_RPC_GLOBAL_KEY]
    installRemoteRpcFetchBridge()

    const responsePromise = globalThis.fetch("/api/remote-instances")
    await Promise.resolve()
    const socket = FakeWebSocket.instances[0]
    expect(socket?.url).toBe("ws://127.0.0.1:3000/api/remote-rpc/ws")
    socket.emitOpen()

    const response = await responsePromise
    expect(response.ok).toBe(true)
    expect(await response.json()).toEqual({ ok: true })
    expect(nativeCalled).toBe(false)
    const frame = socket.sent[0] as {
      target?: unknown
      instanceId?: unknown
      path?: unknown
    }
    expect(frame.target).toBe("local")
    expect(frame.instanceId).toBe(undefined)
    expect(frame.path).toBe("/api/remote-instances")
  })

  test("records websocket RPC request and response summaries for debugging", async () => {
    installBrowserStubs()
    globalThis.fetch = (async () => new Response("native")) as typeof fetch
    const storage = new Map<string, string>([
      ["openchamber_remote_rpc_debug", "1"],
      ["openchamber_remote_rpc_debug_body", "1"],
    ])
    ;(globalThis.window as unknown as {
      localStorage: {
        getItem: (key: string) => string | null
        setItem: (key: string, value: string) => void
        removeItem: (key: string) => void
      }
    }).localStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value) },
      removeItem: (key) => { storage.delete(key) },
    }
    const debugCalls: unknown[][] = []
    const originalDebug = console.debug
    console.debug = (...args: unknown[]) => {
      debugCalls.push(args)
    }

    try {
      delete (globalThis as typeof globalThis & { [REMOTE_RPC_GLOBAL_KEY]?: unknown })[REMOTE_RPC_GLOBAL_KEY]
      installRemoteRpcFetchBridge()

      const responsePromise = globalThis.fetch("/api/remote/remote-a/session/ses_1/prompt_async", {
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      })
      for (let attempt = 0; attempt < 5 && FakeWebSocket.instances.length === 0; attempt += 1) {
        await Promise.resolve()
      }
      const socket = FakeWebSocket.instances[0]
      expect(socket).toBeTruthy()
      socket.emitOpen()

      const response = await responsePromise
      expect(response.headers.get("x-openchamber-rpc-path")).toBe("/api/session/ses_1/prompt_async")
      expect(await response.json()).toEqual({ ok: true })

      const debugApi = (globalThis.window as Window).__openchamberRemoteRpcDebug
      expect(debugApi?.entries.map((entry) => entry.phase)).toEqual(["request", "response"])
      expect(debugApi?.entries[0]?.target).toBe("remote")
      expect(debugApi?.entries[0]?.instanceId).toBe("remote-a")
      expect(debugApi?.entries[0]?.method).toBe("POST")
      expect(debugApi?.entries[0]?.path).toBe("/api/session/ses_1/prompt_async")
      expect(debugApi?.entries[0]?.requestBodyPreview).toBe(JSON.stringify({ text: "hello" }))
      expect(debugApi?.entries[1]?.target).toBe("remote")
      expect(debugApi?.entries[1]?.instanceId).toBe("remote-a")
      expect(debugApi?.entries[1]?.method).toBe("POST")
      expect(debugApi?.entries[1]?.path).toBe("/api/session/ses_1/prompt_async")
      expect(debugApi?.entries[1]?.status).toBe(200)
      expect(debugApi?.entries[1]?.responseBodyPreview).toBe(JSON.stringify({ ok: true }))
      expect(debugApi?.snapshot({ pathIncludes: "prompt_async" })).toHaveLength(2)
      expect(debugApi?.pending()).toEqual([])
      expect(debugCalls.length >= 2).toBe(true)
    } finally {
      console.debug = originalDebug
    }
  })

  test("leaves event endpoints on native transports", async () => {
    installBrowserStubs()
    let nativeUrl = ""
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      nativeUrl = String(input)
      return new Response("native")
    }) as typeof fetch
    delete (globalThis as typeof globalThis & { [REMOTE_RPC_GLOBAL_KEY]?: unknown })[REMOTE_RPC_GLOBAL_KEY]
    installRemoteRpcFetchBridge()

    const response = await globalThis.fetch("/api/global/event")

    expect(await response.text()).toBe("native")
    expect(nativeUrl).toBe("/api/global/event")
    expect(FakeWebSocket.instances).toHaveLength(0)
  })
})
