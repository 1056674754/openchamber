import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { PermissionRequest } from "@/types/permission"

type MockSdkResult = {
  data?: unknown
  error?: unknown
  response?: { status?: number }
}

// Mock SDK client that records permission / question reply calls
const replyCalls: Array<{ method: string; params: Record<string, unknown> }> = []
const sessionCalls: Array<{ method: string; params: Record<string, unknown> }> = []
let permissionReplyResult: MockSdkResult = { data: true }
let permissionRespondResult: MockSdkResult = { data: true }
let sessionRevertResult: MockSdkResult = { data: null }
let sessionUnrevertResult: MockSdkResult = { data: null }
let configState = {
  isConnected: true,
  hasEverConnected: true,
  lastDisconnectReason: null as string | null,
}
let inputStoreState = {
  attachedFiles: [] as unknown[],
  pendingInputText: "",
  pendingInputMode: "append" as "append" | "replace",
}

const mockScopedClient = {
  permission: {
    reply: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.reply", params })
      return Promise.resolve(permissionReplyResult)
    }),
    respond: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.respond", params })
      return Promise.resolve(permissionRespondResult)
    }),
  },
  question: {
    reply: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reply", params })
      return Promise.resolve({ data: true })
    }),
    reject: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve({ data: true })
    }),
  },
  session: {
    abort: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.abort", params })
      return Promise.resolve({ data: true })
    }),
    revert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.revert", params })
      return Promise.resolve(sessionRevertResult)
    }),
    unrevert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.unrevert", params })
      return Promise.resolve(sessionUnrevertResult)
    }),
  },
}

const mockSdk = {
  permission: {
    reply: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.reply", params })
      return Promise.resolve(permissionReplyResult)
    }),
    respond: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "permission.respond", params })
      return Promise.resolve(permissionRespondResult)
    }),
  },
  question: {
    reply: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reply", params })
      return Promise.resolve({ data: true })
    }),
    reject: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve({ data: true })
    }),
  },
  session: {
    abort: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.abort", params })
      return Promise.resolve({ data: true })
    }),
    revert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.revert", params })
      return Promise.resolve(sessionRevertResult)
    }),
    unrevert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.unrevert", params })
      return Promise.resolve(sessionUnrevertResult)
    }),
  },
}

// Mock opencodeClient singleton
mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getScopedSdkClient: (_: string) => mockScopedClient,
    getDirectory: () => "/test/project",
    setDirectory: () => {},
  },
}))

// Mock projects store so session-actions does not load directory-store during tests
mock.module("@/stores/useProjectsStore", () => ({
  useProjectsStore: {
    getState: () => ({
      projects: [],
    }),
  },
}))

// Mock useConfigStore
mock.module("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => ({
      ...configState,
      getConnectionState: () => ({
        isConnected: configState.isConnected,
        hasEverConnected: configState.hasEverConnected,
        connectionPhase: configState.isConnected ? "connected" : "reconnecting",
        lastDisconnectReason: configState.lastDisconnectReason,
      }),
    }),
  },
}))

// Mock useSessionUIStore
mock.module("./session-ui-store", () => ({
  useSessionUIStore: {
    getState: () => ({
      getDirectoryForSession: (sessionId: string) => {
        if (sessionId === "session-a") return "/test/project"
        if (sessionId === "session-b") return "/other/project"
        return null
      },
    }),
  },
}))

// Mock useInputStore
mock.module("./input-store", () => ({
  useInputStore: {
    getState: () => ({
      ...inputStoreState,
      clearAttachedFiles: () => {
        inputStoreState = { ...inputStoreState, attachedFiles: [] }
      },
      addRestoredAttachment: (file: unknown) => {
        inputStoreState = {
          ...inputStoreState,
          attachedFiles: [...inputStoreState.attachedFiles, file],
        }
      },
    }),
    setState: (partial: Partial<typeof inputStoreState>) => {
      inputStoreState = { ...inputStoreState, ...partial }
    },
  },
}))

// Mock useGlobalSessionsStore (imported but not used in permission functions)
mock.module("@/stores/useGlobalSessionsStore", () => ({
  useGlobalSessionsStore: {},
}))

// Mock sync-refs (imported but not used in permission functions)
mock.module("./sync-refs", () => ({
  registerSessionDirectory: () => {},
  setSyncRefs: () => {},
  getSyncChildStores: () => ({
    pin: () => undefined,
    unpin: () => undefined,
  }),
  getAllSyncSessions: () => [],
  getSyncSessions: () => [],
  getSyncDirectory: () => "/test/project",
  getSessionDirectoryFromRoutingIndex: () => undefined,
}))

import { create, type StoreApi } from "zustand"
import { INITIAL_STATE } from "./types"
import type { DirectoryStore } from "./child-store"
import type { Message, OpencodeClient, Part, Session } from "@opencode-ai/sdk/v2/client"
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry"

beforeEach(() => {
  replyCalls.length = 0
  sessionCalls.length = 0
  permissionReplyResult = { data: true }
  permissionRespondResult = { data: true }
  sessionRevertResult = { data: null }
  sessionUnrevertResult = { data: null }
  inputStoreState = {
    attachedFiles: [],
    pendingInputText: "",
    pendingInputMode: "append",
  }
  configState = {
    isConnected: true,
    hasEverConnected: true,
    lastDisconnectReason: null,
  }
  serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" })
  const defaultConnection = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConnection) {
    ;(defaultConnection as { client: OpencodeClient }).client = mockSdk as unknown as OpencodeClient
  }
  serverRegistry.clearSessionServerIndexDebugEntries()
})

function createStore(permissions: Record<string, PermissionRequest[]>): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    permission: permissions,
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }))
}

function createChildStores(entries: Array<[string, StoreApi<DirectoryStore>]>) {
  const stores = new Map(entries)
  return {
    children: stores,
    getChild: (dir: string) => stores.get(dir),
    ensureChild: (dir: string) => {
      const store = stores.get(dir)
      if (!store) throw new Error(`No store for ${dir}`)
      return store
    },
  } as unknown as import("./child-store").ChildStoreManager
}

describe("respondToPermission passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    permissionReplyResult = { data: true }
    permissionRespondResult = { data: true }
    configState = {
      isConnected: true,
      hasEverConnected: true,
      lastDisconnectReason: null,
    }
  })

  test("passes directory from child store when permission is found", async () => {
    const permission: PermissionRequest = {
      id: "perm-1",
      sessionID: "session-a",
      permission: "bash",
      patterns: [],
      metadata: {},
      always: [],
    }

    const store = createStore({ "session-a": [permission] })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToPermission("session-a", "perm-1", "once")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].method).toBe("permission.respond")
    expect(replyCalls[0].params.sessionID).toBe("session-a")
    expect(replyCalls[0].params.permissionID).toBe("perm-1")
    expect(replyCalls[0].params.response).toBe("once")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })

  test("passes directory from session mapping when permission not in store", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToPermission("session-b", "perm-2", "always")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].method).toBe("permission.respond")
    expect(replyCalls[0].params.sessionID).toBe("session-b")
    expect(replyCalls[0].params.permissionID).toBe("perm-2")
    expect(replyCalls[0].params.response).toBe("always")
    expect(replyCalls[0].params.directory).toBe("/other/project")
  })

  test("falls back to request-scoped reply when session-scoped route is missing", async () => {
    permissionRespondResult = { error: { name: "NotFoundError" }, response: { status: 404 } }
    const permission: PermissionRequest = {
      id: "perm-4",
      sessionID: "session-a",
      permission: "bash",
      patterns: [],
      metadata: {},
      always: [],
    }

    const store = createStore({ "session-a": [permission] })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToPermission("session-a", "perm-4", "once")

    expect(replyCalls.length).toBe(2)
    expect(replyCalls[0].method).toBe("permission.respond")
    expect(replyCalls[1].method).toBe("permission.reply")
    expect(replyCalls[1].params.requestID).toBe("perm-4")
    expect(replyCalls[1].params.reply).toBe("once")
    expect(replyCalls[1].params.directory).toBe("/test/project")
  })

  test("fails instead of using current directory as last resort", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/fallback/dir")

    let error: unknown = null
    try {
      await respondToPermission("unknown-session", "perm-3", "reject")
    } catch (err) {
      error = err
    }
    expect(error instanceof Error).toBe(true)
    expect((error as Error).message).toBe("permission reply target directory for request perm-3 is not available")
    expect(replyCalls.length).toBe(0)
  })
})

describe("optimisticSend", () => {
  beforeEach(() => {
    configState = {
      isConnected: true,
      hasEverConnected: true,
      lastDisconnectReason: null,
    }
  })

  test("adds the optimistic user message before waiting for reconnection", async () => {
    configState = {
      isConnected: false,
      hasEverConnected: true,
      lastDisconnectReason: "ws_closed:code=1006",
    }

    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])
    const optimisticAdds: Array<{ sessionID: string; message: { id?: string; role?: string }; parts: Array<{ type?: string; text?: string }>; directory?: string | null; serverId?: string | null }> = []
    const optimisticRemoves: Array<{ sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }> = []
    let sendCalled = false

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      (input) => {
        optimisticAdds.push(input as (typeof optimisticAdds)[number])
      },
      (input) => {
        optimisticRemoves.push(input)
      },
    )

    const sendPromise = optimisticSend({
      sessionId: "session-a",
      content: "hello",
      providerID: "anthropic",
      modelID: "claude",
      send: async () => {
        sendCalled = true
      },
    })

    expect(optimisticAdds).toHaveLength(1)
    expect(optimisticAdds[0].sessionID).toBe("session-a")
    expect(optimisticAdds[0].message.role).toBe("user")
    expect(optimisticAdds[0].parts[0].text).toBe("hello")
    expect(sendCalled).toBe(false)

    configState = {
      isConnected: true,
      hasEverConnected: true,
      lastDisconnectReason: null,
    }

    await sendPromise

    expect(sendCalled).toBe(true)
    expect(optimisticRemoves).toHaveLength(0)
  })

  test("uses explicit target directory for optimistic status and bridge refs", async () => {
    const fallbackStore = createStore({})
    const targetStore = createStore({})
    const childStores = createChildStores([
      ["/fallback/dir", fallbackStore],
      ["/target/project", targetStore],
    ])
    const optimisticAdds: Array<{ sessionID: string; directory?: string | null; serverId?: string | null }> = []
    const optimisticRemoves: Array<{ sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }> = []

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/fallback/dir")
    setOptimisticRefs(
      (input) => {
        optimisticAdds.push(input)
      },
      (input) => {
        optimisticRemoves.push(input)
      },
    )

    await optimisticSend({
      sessionId: "session-new",
      content: "hello target",
      providerID: "anthropic",
      modelID: "claude",
      directory: "/target/project",
      serverId: "default",
      send: async () => {},
    })

    expect(optimisticAdds).toHaveLength(1)
    expect(optimisticAdds[0].directory).toBe("/target/project")
    expect(optimisticAdds[0].serverId).toBe("default")
    expect(targetStore.getState().session_status["session-new"]?.type).toBe("busy")
    expect(fallbackStore.getState().session_status["session-new"]).toBe(undefined)
    expect(optimisticRemoves).toHaveLength(0)
  })

  test("does not abort a busy session for normal sends", async () => {
    const store = createStore({})
    store.setState({
      session_status: {
        "session-a": { type: "busy" },
      },
    })
    const childStores = createChildStores([["/test/project", store]])
    let sendCalled = false

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(() => {}, () => {})

    await optimisticSend({
      sessionId: "session-a",
      content: "hello while busy",
      providerID: "anthropic",
      modelID: "claude",
      send: async () => {
        sendCalled = true
      },
    })

    expect(sendCalled).toBe(true)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(0)
  })

  test("aborts a busy session only for interrupt delivery", async () => {
    const store = createStore({})
    store.setState({
      session_status: {
        "session-a": { type: "busy" },
      },
    })
    const childStores = createChildStores([["/test/project", store]])
    let sendCalled = false

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(() => {}, () => {})

    await optimisticSend({
      sessionId: "session-a",
      content: "interrupt me",
      providerID: "anthropic",
      modelID: "claude",
      deliveryMode: "interrupt",
      send: async () => {
        sendCalled = true
      },
    })

    expect(sendCalled).toBe(true)
    const abortCalls = sessionCalls.filter((call) => call.method === "session.abort")
    expect(abortCalls).toHaveLength(1)
    expect(abortCalls[0].params.sessionID).toBe("session-a")
    expect(abortCalls[0].params.directory).toBe("/test/project")
  })

  test("allows shell sends to provide a custom optimistic display part", async () => {
    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])
    const optimisticAdds: Array<{ sessionID: string; message: { id?: string; role?: string }; parts: Array<{ type?: string; text?: string; shellAction?: { command?: string; status?: string } }> }> = []

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      (input) => {
        optimisticAdds.push(input as (typeof optimisticAdds)[number])
      },
      () => {},
    )

    await optimisticSend({
      sessionId: "session-a",
      content: "The following tool was executed by the user",
      providerID: "anthropic",
      modelID: "claude",
      buildOptimisticParts: ({ createPartID }) => [{
        id: createPartID(),
        type: "text",
        text: "/shell",
        shellAction: { command: "ls -la", status: "running" },
      } as unknown as Part],
      send: async () => {},
    })

    expect(optimisticAdds).toHaveLength(1)
    expect(optimisticAdds[0].parts).toHaveLength(1)
    expect(optimisticAdds[0].parts[0].text).toBe("/shell")
    expect(optimisticAdds[0].parts[0].shellAction?.command).toBe("ls -la")
    expect(optimisticAdds[0].parts[0].shellAction?.status).toBe("running")
  })

  test("materializes returned shell message parts and clears busy status", async () => {
    const store = createStore({})
    store.setState({
      session_status: {
        "session-a": { type: "busy" },
      },
    })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, materializeReturnedMessage } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    const info = {
      id: "msg_assistant",
      sessionID: "session-a",
      role: "assistant",
      time: { created: 1, completed: 2 },
      parentID: "msg_user",
    } as unknown as Message
    const part = {
      id: "prt_shell",
      messageID: "msg_assistant",
      sessionID: "session-a",
      type: "tool",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls -la" },
        output: "ok",
        time: { start: 1, end: 2 },
      },
    } as unknown as Part

    materializeReturnedMessage({
      sessionId: "session-a",
      directory: "/test/project",
      record: { info, parts: [part] },
      setIdle: true,
    })

    const state = store.getState()
    expect(state.message["session-a"]?.[0]?.id).toBe("msg_assistant")
    expect(state.part["msg_assistant"]?.[0]?.id).toBe("prt_shell")
    expect(state.session_status["session-a"]?.type).toBe("idle")
  })
})

describe("dismissPermission passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
    permissionReplyResult = { data: true }
    permissionRespondResult = { data: true }
  })

  test("passes directory and response=reject", async () => {
    const permission: PermissionRequest = {
      id: "perm-10",
      sessionID: "session-a",
      permission: "edit",
      patterns: [],
      metadata: {},
      always: [],
    }

    const store = createStore({ "session-a": [permission] })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, dismissPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await dismissPermission("session-a", "perm-10")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].method).toBe("permission.respond")
    expect(replyCalls[0].params.sessionID).toBe("session-a")
    expect(replyCalls[0].params.permissionID).toBe("perm-10")
    expect(replyCalls[0].params.response).toBe("reject")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })
})

describe("respondToQuestion passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
  })

  test("passes directory to question.reply", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToQuestion("session-a", "q-1", [["answer1"]])

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-1")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })

  test("uses explicit directory hint when request is recovered outside the store", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToQuestion("unknown-session", "q-recovered", [["answer1"]], "/recovered/project")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-recovered")
    expect(replyCalls[0].params.directory).toBe("/recovered/project")
  })
})

describe("rejectQuestion passes directory", () => {
  beforeEach(() => {
    replyCalls.length = 0
  })

  test("passes directory to question.reject", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, rejectQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await rejectQuestion("session-a", "q-2")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-2")
    expect(replyCalls[0].params.directory).toBe("/test/project")
  })

  test("uses explicit directory hint when recovered request is rejected outside the store", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, rejectQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await rejectQuestion("unknown-session", "q-recovered", "/recovered/project")

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.requestID).toBe("q-recovered")
    expect(replyCalls[0].params.directory).toBe("/recovered/project")
  })
})

describe("revertToMessage", () => {
  test("rolls back optimistic state when SDK returns an error payload", async () => {
    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])
    const previousRevert = { messageID: "msg_previous", snapshot: "snapshot_previous" }

    store.setState({
      session: [{
        id: "session-a",
        parentID: undefined,
        title: "Session A",
        version: "1",
        time: { created: 1, updated: 1 },
        revert: previousRevert,
      } as unknown as Session],
      message: {
        "session-a": [{
          id: "msg_target",
          sessionID: "session-a",
          role: "user",
          time: { created: 2 },
        } as unknown as Message],
      },
      part: {
        msg_target: [{
          id: "prt_target",
          messageID: "msg_target",
          sessionID: "session-a",
          type: "text",
          text: "please change this",
        } as unknown as Part],
      },
    })

    inputStoreState = {
      attachedFiles: [{ id: "previous-attachment" }],
      pendingInputText: "previous draft",
      pendingInputMode: "append",
    }
    sessionRevertResult = {
      error: { message: "snapshot not found" },
      response: { status: 404 },
    }

    const { setActionRefs, revertToMessage } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    let error: unknown = null
    try {
      await revertToMessage("session-a", "msg_target")
    } catch (err) {
      error = err
    }

    expect(error instanceof Error).toBe(true)
    expect((error as Error).message).toBe("session.revert failed (404): snapshot not found")
    expect(sessionCalls).toHaveLength(1)
    expect(sessionCalls[0].method).toBe("session.revert")
    expect(sessionCalls[0].params.directory).toBe("/test/project")
    expect((store.getState().session[0] as Session & { revert?: unknown }).revert).toEqual(previousRevert)
    expect(inputStoreState.pendingInputText).toBe("previous draft")
    expect(inputStoreState.pendingInputMode).toBe("append")
    expect(inputStoreState.attachedFiles).toEqual([{ id: "previous-attachment" }])
  })
})
