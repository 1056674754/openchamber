import { describe, expect, test, beforeEach, mock } from "bun:test"
import type { PermissionRequest } from "@/types/permission"
import type { QuestionRequest } from "@/types/question"

type MockSdkResult = {
  data?: unknown
  error?: unknown
  response?: { status?: number }
}

async function expectRejectsWithMessage(promise: Promise<unknown>, message: string): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }

  if (!(caught instanceof Error)) {
    throw new Error("Expected promise to reject with an Error")
  }
  expect(caught.message.includes(message)).toBe(true)
}

// Mock SDK client that records permission / question reply calls
const replyCalls: Array<{ method: string; params: Record<string, unknown> }> = []
const sessionCalls: Array<{ method: string; params: Record<string, unknown> }> = []
let permissionReplyResult: MockSdkResult = { data: true }
let permissionRespondResult: MockSdkResult = { data: true }
let questionReplyResult: MockSdkResult = { data: true }
let questionRejectResult: MockSdkResult = { data: true }
let sessionAbortResult: MockSdkResult = { data: true }
let sessionCreateResult: MockSdkResult = { data: null }
let sessionRevertResult: MockSdkResult = { data: null }
let sessionUnrevertResult: MockSdkResult = { data: null }
let sessionForkResult: MockSdkResult = { data: null }
let sessionMessagesResult: MockSdkResult = { data: [] }
let configState = {
  isConnected: true,
  hasEverConnected: true,
  lastDisconnectReason: null as string | null,
}
let inputStoreState = {
  attachedFiles: [] as unknown[],
  attachmentSessionKey: null as string | null,
  pendingInputText: "",
  pendingInputMode: "append" as "append" | "replace",
}

let moveSessionResult: MockSdkResult = { response: { status: 204 } }
const globalUpsertedSessions: Array<{ id: string; directory?: string }> = []

const mockScopedClient = {
  experimental: {
    controlPlane: {
      moveSession: mock((params: Record<string, unknown>) => {
        sessionCalls.push({ method: "controlPlane.moveSession", params })
        return Promise.resolve(moveSessionResult)
      }),
    },
  },
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
      return Promise.resolve(questionReplyResult)
    }),
    reject: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve(questionRejectResult)
    }),
  },
  session: {
    messages: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.messages", params })
      return Promise.resolve(sessionMessagesResult)
    }),
    create: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.create", params })
      return Promise.resolve(sessionCreateResult)
    }),
    abort: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.abort", params })
      return Promise.resolve(sessionAbortResult)
    }),
    revert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.revert", params })
      return Promise.resolve(sessionRevertResult)
    }),
    unrevert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.unrevert", params })
      return Promise.resolve(sessionUnrevertResult)
    }),
    fork: mock(() => Promise.resolve(sessionForkResult)),
  },
}

const mockSdk = {
  experimental: {
    controlPlane: {
      moveSession: mock((params: Record<string, unknown>) => {
        sessionCalls.push({ method: "controlPlane.moveSession", params })
        return Promise.resolve(moveSessionResult)
      }),
    },
  },
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
      return Promise.resolve(questionReplyResult)
    }),
    reject: mock((params: Record<string, unknown>) => {
      replyCalls.push({ method: "question.reject", params })
      return Promise.resolve(questionRejectResult)
    }),
  },
  session: {
    messages: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.messages", params })
      return Promise.resolve(sessionMessagesResult)
    }),
    create: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.create", params })
      return Promise.resolve(sessionCreateResult)
    }),
    abort: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.abort", params })
      return Promise.resolve(sessionAbortResult)
    }),
    revert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.revert", params })
      return Promise.resolve(sessionRevertResult)
    }),
    unrevert: mock((params: Record<string, unknown>) => {
      sessionCalls.push({ method: "session.unrevert", params })
      return Promise.resolve(sessionUnrevertResult)
    }),
    fork: mock(() => Promise.resolve(sessionForkResult)),
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
const sessionUiStoreState = {
  getDirectoryForSession: (sessionId: string) => {
    if (sessionId === "session-a") return "/test/project"
    if (sessionId === "session-b") return "/other/project"
    return null
  },
  setCurrentSession: () => {},
}
mock.module("./session-ui-store", () => ({
  useSessionUIStore: {
    getState: () => sessionUiStoreState,
  },
}))

// Mock useInputStore
mock.module("./input-store", () => ({
  DRAFT_ATTACHMENT_SESSION_KEY: "__draft__",
  useInputStore: {
    getState: () => ({
      ...inputStoreState,
      setAttachmentSessionKey: (sessionKey: string | null) => {
        inputStoreState = { ...inputStoreState, attachmentSessionKey: sessionKey }
      },
      setAttachedFiles: (files: unknown[]) => {
        inputStoreState = { ...inputStoreState, attachedFiles: files }
      },
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

// Mock useGlobalSessionsStore
mock.module("@/stores/useGlobalSessionsStore", () => ({
  useGlobalSessionsStore: {
    getState: () => ({
      upsertSession: (session: { id: string; directory?: string }) => {
        globalUpsertedSessions.push(session)
      },
    }),
  },
}))

// Mock sync-refs (imported but not used in permission functions)
const registerSessionDirectoryCalls: Array<{ sessionID: string; directory: string }> = []
mock.module("./sync-refs", () => ({
  registerSessionDirectory: (sessionID: string, directory: string) => {
    registerSessionDirectoryCalls.push({ sessionID, directory })
  },
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
import { useI18nStore } from "@/lib/i18n/store"
import { dict as enDict } from "@/lib/i18n/messages/en"
import { dict as zhCnDict } from "@/lib/i18n/messages/zh-CN"

beforeEach(() => {
  replyCalls.length = 0
  sessionCalls.length = 0
  registerSessionDirectoryCalls.length = 0
  globalUpsertedSessions.length = 0
  permissionReplyResult = { data: true }
  permissionRespondResult = { data: true }
  questionReplyResult = { data: true }
  questionRejectResult = { data: true }
  sessionAbortResult = { data: true }
  sessionCreateResult = { data: null }
  sessionRevertResult = { data: null }
  sessionUnrevertResult = { data: null }
  sessionForkResult = { data: null }
  sessionMessagesResult = { data: [] }
  moveSessionResult = { response: { status: 204 } }
  inputStoreState = {
    attachedFiles: [],
    attachmentSessionKey: null,
    pendingInputText: "",
    pendingInputMode: "append",
  }
  configState = {
    isConnected: true,
    hasEverConnected: true,
    lastDisconnectReason: null,
  }
  useI18nStore.setState({
    locale: "en",
    dictionary: enDict,
    loadingLocale: null,
  })
  serverRegistry.register({ id: DEFAULT_SERVER_ID, label: "Default", baseUrl: "/api" })
  const defaultConnection = serverRegistry.get(DEFAULT_SERVER_ID)
  if (defaultConnection) {
    ;(defaultConnection as { client: OpencodeClient }).client = mockSdk as unknown as OpencodeClient
  }
  serverRegistry.clearSessionServerIndexDebugEntries()
})

function createStore(
  permissions: Record<string, PermissionRequest[]>,
  questions: Record<string, QuestionRequest[]> = {},
  overrides: Partial<DirectoryStore> = {},
): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    permission: permissions,
    question: questions,
    ...overrides,
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

describe("waitForConnectionOrThrow", () => {
  test("localizes an upstream stall instead of exposing an internal reason code", async () => {
    configState = {
      isConnected: false,
      hasEverConnected: true,
      lastDisconnectReason: "upstream_stalled",
    }
    useI18nStore.setState({
      locale: "zh-CN",
      dictionary: zhCnDict,
      loadingLocale: null,
    })

    const { waitForConnectionOrThrow } = await import("./session-actions")

    await expectRejectsWithMessage(
      waitForConnectionOrThrow(),
      "OpenCode 事件流已停止响应，OpenChamber 正在自动重连。",
    )
  })
})

describe("createSession", () => {
  test("preserves the upstream SDK error when session creation fails", async () => {
    sessionCreateResult = {
      error: {
        name: "UnknownError",
        data: {
          message: "Session storage is not writable",
          ref: "err_session_create",
        },
      },
      response: { status: 500 },
    }
    const childStores = createChildStores([])

    const { createSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await expectRejectsWithMessage(
      createSession(undefined, "/test/project", null, DEFAULT_SERVER_ID),
      "session.create failed (500): Session storage is not writable (err_session_create)",
    )
  })
})

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

  test("uses the event routing target before permission state reaches the child store", async () => {
    const childStores = createChildStores([])

    const { setActionRefs, respondToPermission } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToPermission("new-child", "perm-event", "once", {
      directory: "/event/project",
      serverId: DEFAULT_SERVER_ID,
    })

    expect(replyCalls.length).toBe(1)
    expect(replyCalls[0].params.sessionID).toBe("new-child")
    expect(replyCalls[0].params.permissionID).toBe("perm-event")
    expect(replyCalls[0].params.directory).toBe("/event/project")
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

  test("commits a new branch after revert and discards reverted optimistic shadows", async () => {
    const retainedMessage = {
      id: "msg_1",
      role: "user",
      sessionID: "session-reverted",
    } as unknown as Message
    const revertedMessage = {
      id: "msg_2",
      role: "user",
      sessionID: "session-reverted",
    } as unknown as Message
    const revertedPart = {
      id: "prt_2",
      messageID: revertedMessage.id,
      sessionID: "session-reverted",
      type: "text",
      text: "reverted",
    } as unknown as Part
    const targetStore = createStore({}, {}, {
      session: [{
        id: "session-reverted",
        directory: "/target/project",
        revert: { messageID: revertedMessage.id },
      } as unknown as Session],
      message: {
        "session-reverted": [retainedMessage, revertedMessage],
      },
      part: {
        [revertedMessage.id]: [revertedPart],
      },
    })
    const childStores = createChildStores([["/target/project", targetStore]])
    const optimisticShadow = new Set([revertedMessage.id])
    let optimisticMessageID = ""

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/target/project")
    setOptimisticRefs(
      (input) => {
        optimisticMessageID = input.message.id
        optimisticShadow.add(input.message.id)
        const state = targetStore.getState()
        targetStore.setState({
          message: {
            ...state.message,
            [input.sessionID]: [...(state.message[input.sessionID] ?? []), input.message],
          },
          part: {
            ...state.part,
            [input.message.id]: input.parts,
          },
        })
      },
      () => {},
      (input) => {
        optimisticShadow.delete(input.messageID)
      },
    )

    await optimisticSend({
      sessionId: "session-reverted",
      content: "new branch",
      providerID: "provider",
      modelID: "model",
      directory: "/target/project",
      serverId: DEFAULT_SERVER_ID,
      send: async () => {},
    })

    expect(targetStore.getState().session[0]?.revert).toBe(undefined)
    expect(targetStore.getState().message["session-reverted"]?.map((message) => message.id)).toEqual([
      retainedMessage.id,
      optimisticMessageID,
    ])
    expect(targetStore.getState().part[revertedMessage.id]).toBe(undefined)
    expect(optimisticShadow.has(revertedMessage.id)).toBe(false)
    expect(optimisticShadow.has(optimisticMessageID)).toBe(true)
  })

  test("confirms an ambiguous send failure from the authoritative session messages", async () => {
    class AmbiguousSendError extends Error {
      readonly status = 504
    }

    const store = createStore({})
    const childStores = createChildStores([["/target/project", store]])
    const optimisticRemoves: Array<{ sessionID: string; messageID: string }> = []
    const optimisticConfirms: Array<{ sessionID: string; messageID: string; directory?: string | null; serverId?: string | null }> = []
    let sentMessageID = ""

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/fallback/dir")
    setOptimisticRefs(
      () => {},
      (input) => optimisticRemoves.push(input),
      (input) => optimisticConfirms.push(input),
    )

    await optimisticSend({
      sessionId: "session-confirmed",
      content: "hello",
      providerID: "provider",
      modelID: "model",
      directory: "/target/project",
      serverId: DEFAULT_SERVER_ID,
      send: async (messageID) => {
        sentMessageID = messageID
        sessionMessagesResult = {
          data: [{
            info: {
              id: messageID,
              sessionID: "session-confirmed",
              role: "user",
              time: { created: 1 },
            } as unknown as Message,
            parts: [{ id: "server-part", type: "text", text: "hello" } as unknown as Part],
          }],
        }
        throw new AmbiguousSendError("gateway timeout")
      },
    })

    expect(optimisticRemoves).toHaveLength(0)
    expect(optimisticConfirms).toHaveLength(1)
    expect(optimisticConfirms[0]?.messageID).toBe(sentMessageID)
    expect(optimisticConfirms[0]?.directory).toBe("/target/project")
    expect(optimisticConfirms[0]?.serverId).toBe(DEFAULT_SERVER_ID)
    const confirmationCall = sessionCalls.find((call) => call.method === "session.messages")
    expect(confirmationCall?.params.sessionID).toBe("session-confirmed")
    expect(confirmationCall?.params.directory).toBe("/target/project")
    expect(confirmationCall?.params.limit).toBe(30)
    expect(store.getState().message["session-confirmed"]?.[0]?.id).toBe(sentMessageID)
    expect(store.getState().part[sentMessageID]?.[0]?.id).toBe("server-part")
  })

  test("rolls back an ambiguous send failure when the message was not accepted", async () => {
    class AmbiguousSendError extends Error {
      readonly status = 503
    }

    const store = createStore({})
    const childStores = createChildStores([["/target/project", store]])
    const optimisticRemoves: Array<{ sessionID: string; messageID: string }> = []
    const optimisticConfirms: Array<{ sessionID: string; messageID: string }> = []

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/fallback/dir")
    setOptimisticRefs(
      () => {},
      (input) => optimisticRemoves.push(input),
      (input) => optimisticConfirms.push(input),
    )

    await expectRejectsWithMessage(optimisticSend({
      sessionId: "session-missing",
      content: "hello",
      providerID: "provider",
      modelID: "model",
      directory: "/target/project",
      serverId: DEFAULT_SERVER_ID,
      send: async () => {
        throw new AmbiguousSendError("service unavailable")
      },
    }), "service unavailable")

    expect(optimisticRemoves).toHaveLength(1)
    expect(optimisticConfirms).toHaveLength(0)
    expect(sessionCalls.filter((call) => call.method === "session.messages")).toHaveLength(2)
    expect(store.getState().session_status["session-missing"]?.type).toBe("idle")
  })

  test("rejects normal sends while a session is busy", async () => {
    const store = createStore({})
    store.setState({
      session_status: {
        "session-a": { type: "busy" },
      },
    })
    const childStores = createChildStores([["/test/project", store]])
    let sendCalled = false
    const optimisticAdds: Array<unknown> = []
    const optimisticRemoves: Array<unknown> = []

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(
      (input) => {
        optimisticAdds.push(input)
      },
      (input) => {
        optimisticRemoves.push(input)
      },
    )

    await expectRejectsWithMessage(optimisticSend({
      sessionId: "session-a",
      content: "hello while busy",
      providerID: "anthropic",
      modelID: "claude",
      send: async () => {
        sendCalled = true
      },
    }), "already running")

    expect(sendCalled).toBe(false)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(0)
    expect(optimisticAdds).toHaveLength(0)
    expect(optimisticRemoves).toHaveLength(0)
  })

  test("rejects normal sends while the trailing assistant message is incomplete", async () => {
    const store = createStore({})
    store.setState({
      message: {
        "session-a": [{
          id: "msg-assistant",
          sessionID: "session-a",
          role: "assistant",
          time: { created: Date.now() },
        } as unknown as Message],
      },
    })
    const childStores = createChildStores([["/test/project", store]])
    let sendCalled = false

    const { setActionRefs, setOptimisticRefs, optimisticSend } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    setOptimisticRefs(() => {}, () => {})

    await expectRejectsWithMessage(optimisticSend({
      sessionId: "session-a",
      content: "hello while assistant incomplete",
      providerID: "anthropic",
      modelID: "claude",
      send: async () => {
        sendCalled = true
      },
    }), "already running")

    expect(sendCalled).toBe(false)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(0)
  })

  test("sends steer delivery without aborting a busy session", async () => {
    const store = createStore({})
    store.setState({
      session_status: {
        "session-a": { type: "busy" },
      },
    })
    const childStores = createChildStores([["/test/project", store]])
    let sendCalled = false
    const optimisticAdds: Array<{ message: { metadata?: Record<string, unknown> } }> = []

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
      content: "steer me",
      providerID: "anthropic",
      modelID: "claude",
      deliveryMode: "steer",
      send: async () => {
        sendCalled = true
      },
    })

    expect(sendCalled).toBe(true)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(0)
    expect(optimisticAdds[0]?.message.metadata?.openchamberLiveSteer).toBe(true)
    expect(optimisticAdds[0]?.message.metadata?.openchamberDeliveryMode).toBe("steer")
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

describe("dismissOpenPermissionsForSession", () => {
  test("dismisses permissions for the session subtree without touching unrelated sessions", async () => {
    const rootId = "permission-dismiss-root"
    const childId = "permission-dismiss-child"
    const unrelatedId = "permission-dismiss-unrelated"
    const permission = (id: string, sessionID: string): PermissionRequest => ({
      id,
      sessionID,
      permission: "edit",
      patterns: [],
      metadata: {},
      always: [],
    })
    const store = createStore({
      [rootId]: [permission("perm-root", rootId)],
      [childId]: [permission("perm-child", childId)],
      [unrelatedId]: [permission("perm-unrelated", unrelatedId)],
    })
    store.setState({
      session: [
        { id: rootId } as Session,
        { id: childId, parentID: rootId } as Session,
        { id: unrelatedId } as Session,
      ],
    })
    const childStores = createChildStores([["/test/project", store]])

    const { dismissOpenPermissionsForSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    serverRegistry.indexSession(rootId, DEFAULT_SERVER_ID)
    serverRegistry.indexSession(childId, DEFAULT_SERVER_ID)

    try {
      expect(await dismissOpenPermissionsForSession(rootId)).toBe(true)
      expect(replyCalls.filter((call) => call.method === "permission.respond").map((call) => call.params.permissionID).sort()).toEqual([
        "perm-child",
        "perm-root",
      ])
      expect(replyCalls.filter((call) => call.method === "permission.respond").every((call) => call.params.response === "reject")).toBe(true)
      expect(store.getState().permission[rootId]).toBe(undefined)
      expect(store.getState().permission[childId]).toBe(undefined)
      expect(store.getState().permission[unrelatedId]?.[0]?.id).toBe("perm-unrelated")
    } finally {
      serverRegistry.forgetSession(rootId)
      serverRegistry.forgetSession(childId)
    }
  })

  test("uses the owning remote target and restores only a failed permission", async () => {
    const serverId = "remote-permission-dismiss"
    const rootId = "remote-permission-root"
    const childId = "remote-permission-child"
    const remoteCalls: Array<Record<string, unknown>> = []
    const remoteClient = {
      permission: {
        respond: mock((params: Record<string, unknown>) => {
          remoteCalls.push(params)
          return Promise.resolve({ data: params.permissionID !== "perm-remote-child" })
        }),
        reply: mock(() => Promise.resolve({ data: false })),
      },
    } as unknown as OpencodeClient
    serverRegistry.register({ id: serverId, label: "Remote permission", baseUrl: "/api/remote/permission" })
    const connection = serverRegistry.get(serverId)
    if (connection) {
      ;(connection as { client: OpencodeClient }).client = remoteClient
    }

    const permission = (id: string, sessionID: string): PermissionRequest => ({
      id,
      sessionID,
      permission: "bash",
      patterns: [],
      metadata: {},
      always: [],
    })
    const store = createStore({
      [rootId]: [permission("perm-remote-root", rootId)],
      [childId]: [permission("perm-remote-child", childId)],
    })
    store.setState({
      session: [
        { id: rootId } as Session,
        { id: childId, parentID: rootId } as Session,
      ],
    })
    const remoteStores = createChildStores([["/remote/project", store]])
    const { registerSyncStores } = await import("./multi-server-registry")
    const unregisterStores = registerSyncStores(serverId, remoteStores, () => {})
    serverRegistry.indexSession(rootId, serverId)
    serverRegistry.indexSession(childId, serverId)

    try {
      const { dismissOpenPermissionsForSession } = await import("./session-actions")
      expect(await dismissOpenPermissionsForSession(rootId)).toBe(true)
      expect(remoteCalls.map((call) => call.permissionID).sort()).toEqual([
        "perm-remote-child",
        "perm-remote-root",
      ])
      expect(remoteCalls.every((call) => call.directory === "/remote/project")).toBe(true)
      expect(store.getState().permission[rootId]).toBe(undefined)
      expect(store.getState().permission[childId]?.[0]?.id).toBe("perm-remote-child")
    } finally {
      unregisterStores()
      serverRegistry.forgetSession(rootId)
      serverRegistry.forgetSession(childId)
      serverRegistry.unregister(serverId)
    }
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

  test("optimistically removes only the replied question after SDK success", async () => {
    const questions: QuestionRequest[] = [
      { id: "q-1", sessionID: "session-a", questions: [] },
      { id: "q-2", sessionID: "session-a", questions: [] },
    ]
    const store = createStore({}, { "session-a": questions })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, respondToQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await respondToQuestion("session-a", "q-1", [["answer1"]])

    expect(store.getState().question["session-a"]?.map((question) => question.id)).toEqual(["q-2"])
  })

  test("does not remove a question when SDK reply fails", async () => {
    questionReplyResult = { data: false }
    const questions: QuestionRequest[] = [
      { id: "q-1", sessionID: "session-a", questions: [] },
    ]
    const store = createStore({}, { "session-a": questions })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, respondToQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await expectRejectsWithMessage(respondToQuestion("session-a", "q-1", [["answer1"]]), "Question reply failed")

    expect(store.getState().question["session-a"]?.map((question) => question.id)).toEqual(["q-1"])
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

  test("optimistically removes rejected questions after SDK success", async () => {
    const questions: QuestionRequest[] = [
      { id: "q-1", sessionID: "session-a", questions: [] },
    ]
    const store = createStore({}, { "session-a": questions })
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, rejectQuestion } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    await rejectQuestion("session-a", "q-1")

    expect(store.getState().question["session-a"]).toBe(undefined)
  })
})

describe("dismissOpenQuestionsForSession", () => {
  test("dismisses questions for the session subtree without touching unrelated sessions", async () => {
    const rootId = "dismiss-root"
    const childId = "dismiss-child"
    const unrelatedId = "dismiss-unrelated"
    const store = createStore({}, {
      [rootId]: [{ id: "q-root", sessionID: rootId, questions: [] }],
      [childId]: [{ id: "q-child", sessionID: childId, questions: [] }],
      [unrelatedId]: [{ id: "q-unrelated", sessionID: unrelatedId, questions: [] }],
    })
    store.setState({
      session: [
        { id: rootId } as Session,
        { id: childId, parentID: rootId } as Session,
        { id: unrelatedId } as Session,
      ],
    })
    const childStores = createChildStores([["/test/project", store]])

    const { dismissOpenQuestionsForSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    serverRegistry.indexSession(rootId, DEFAULT_SERVER_ID)
    serverRegistry.indexSession(childId, DEFAULT_SERVER_ID)

    try {
      expect(await dismissOpenQuestionsForSession(rootId)).toBe(true)
      expect(replyCalls.filter((call) => call.method === "question.reject").map((call) => call.params.requestID).sort()).toEqual([
        "q-child",
        "q-root",
      ])
      expect(store.getState().question[rootId]).toBe(undefined)
      expect(store.getState().question[childId]).toBe(undefined)
      expect(store.getState().question[unrelatedId]?.[0]?.id).toBe("q-unrelated")
    } finally {
      serverRegistry.forgetSession(rootId)
      serverRegistry.forgetSession(childId)
    }
  })

  test("uses the owning remote server and directory for every dismissal", async () => {
    const serverId = "remote-question-dismiss"
    const rootId = "remote-dismiss-root"
    const childId = "remote-dismiss-child"
    const remoteCalls: Array<Record<string, unknown>> = []
    const remoteClient = {
      question: {
        reject: mock((params: Record<string, unknown>) => {
          remoteCalls.push(params)
          return Promise.resolve({ data: true })
        }),
      },
    } as unknown as OpencodeClient
    serverRegistry.register({ id: serverId, label: "Remote question", baseUrl: "/api/remote/question" })
    const connection = serverRegistry.get(serverId)
    if (connection) {
      ;(connection as { client: OpencodeClient }).client = remoteClient
    }

    const store = createStore({}, {
      [rootId]: [{ id: "q-remote-root", sessionID: rootId, questions: [] }],
      [childId]: [{ id: "q-remote-child", sessionID: childId, questions: [] }],
    })
    store.setState({
      session: [
        { id: rootId } as Session,
        { id: childId, parentID: rootId } as Session,
      ],
    })
    const remoteStores = createChildStores([["/remote/project", store]])
    const { registerSyncStores } = await import("./multi-server-registry")
    const unregisterStores = registerSyncStores(serverId, remoteStores, () => {})
    serverRegistry.indexSession(rootId, serverId)
    serverRegistry.indexSession(childId, serverId)

    try {
      const { dismissOpenQuestionsForSession } = await import("./session-actions")
      expect(await dismissOpenQuestionsForSession(rootId)).toBe(true)
      expect(remoteCalls.map((call) => call.requestID).sort()).toEqual(["q-remote-child", "q-remote-root"])
      expect(remoteCalls.every((call) => call.directory === "/remote/project")).toBe(true)
      expect(replyCalls.filter((call) => call.method === "question.reject")).toHaveLength(0)
    } finally {
      unregisterStores()
      serverRegistry.forgetSession(rootId)
      serverRegistry.forgetSession(childId)
      serverRegistry.unregister(serverId)
    }
  })

  test("restores the question without discarding the queued send path when rejection fails", async () => {
    questionRejectResult = { data: false }
    const rootId = "dismiss-failure-root"
    const store = createStore({}, {
      [rootId]: [{ id: "q-failure", sessionID: rootId, questions: [] }],
    })
    store.setState({ session: [{ id: rootId } as Session] })
    const childStores = createChildStores([["/test/project", store]])

    const { dismissOpenQuestionsForSession, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")
    serverRegistry.indexSession(rootId, DEFAULT_SERVER_ID)

    try {
      expect(await dismissOpenQuestionsForSession(rootId)).toBe(true)
      expect(store.getState().question[rootId]?.[0]?.id).toBe("q-failure")
    } finally {
      serverRegistry.forgetSession(rootId)
    }
  })
})

describe("abortCurrentOperation", () => {
  test("uses the session directory instead of the active UI directory", async () => {
    const sessionId = "abort-cross-directory-session"
    const activeStore = createStore({})
    const sessionStore = createStore({})
    sessionStore.setState({ session: [{ id: sessionId } as Session] })
    const childStores = createChildStores([
      ["/test/active", activeStore],
      ["/test/session", sessionStore],
    ])

    const { setActionRefs, abortCurrentOperation } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/active")

    expect(await abortCurrentOperation(sessionId)).toBe(true)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toEqual([
      { method: "session.abort", params: { sessionID: sessionId, directory: "/test/session" } },
    ])
  })

  test("returns false when SDK abort reports an error", async () => {
    sessionAbortResult = { error: { name: "InternalError", message: "abort failed" }, response: { status: 500 } }
    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, abortCurrentOperation } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    const aborted = await abortCurrentOperation("session-a")

    expect(aborted).toBe(false)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(1)
  })

  test("returns false when SDK abort returns false", async () => {
    sessionAbortResult = { data: false }
    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])

    const { setActionRefs, abortCurrentOperation } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

    const aborted = await abortCurrentOperation("session-a")

    expect(aborted).toBe(false)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(1)
  })

  test("fails closed when session directory is unknown (does not use live UI directory)", async () => {
    const activeStore = createStore({})
    const childStores = createChildStores([["/test/active", activeStore]])

    const { setActionRefs, abortCurrentOperation } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/active")

    const aborted = await abortCurrentOperation("missing-session")

    expect(aborted).toBe(false)
    expect(sessionCalls.filter((call) => call.method === "session.abort")).toHaveLength(0)
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
      attachmentSessionKey: null,
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

describe("forkFromMessage remote directory authority ordering", () => {
  test("registers directory in routing index before indexing server for remote forked session", async () => {
    const remoteServerId = "remote-fork-order-test"
    serverRegistry.register({ id: remoteServerId, label: "Remote Fork", baseUrl: "/api/remote/fork-order" })
    const remoteConnection = serverRegistry.get(remoteServerId)
    if (remoteConnection) {
      ;(remoteConnection as { client: OpencodeClient }).client = mockSdk as unknown as OpencodeClient
    }
    serverRegistry.indexSession("session-a", remoteServerId)

    sessionForkResult = {
      data: {
        id: "ses_forked",
        title: "Forked",
        time: { created: 1, updated: 1 },
        directory: "/test/project",
      } as unknown,
    }

    const store = createStore({})
    const childStores = createChildStores([["/test/project", store]])

    const indexSessionTimeline: Array<{ sessionId: string; registerAlreadyCalled: boolean }> = []
    const originalIndexSession = serverRegistry.indexSession.bind(serverRegistry)
    const spyIndexSession = (sessionId: string, sid: string) => {
      const registerAlreadyCalled = registerSessionDirectoryCalls.some((c) => c.sessionID === sessionId)
      indexSessionTimeline.push({ sessionId, registerAlreadyCalled })
      return originalIndexSession(sessionId, sid)
    }
    serverRegistry.indexSession = spyIndexSession

    try {
      const { setActionRefs, forkFromMessage } = await import("./session-actions")
      setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/test/project")

      await forkFromMessage("session-a", "msg-1")

      const registerEntry = registerSessionDirectoryCalls.find((c) => c.sessionID === "ses_forked")
      expect(registerEntry).not.toBeNull()
      expect(registerEntry?.directory).toBe("/test/project")

      const indexEntry = indexSessionTimeline.find((e) => e.sessionId === "ses_forked")
      expect(indexEntry).not.toBeNull()
      expect(indexEntry?.registerAlreadyCalled).toBe(true)
    } finally {
      serverRegistry.indexSession = originalIndexSession
      serverRegistry.forgetSession("ses_forked")
      serverRegistry.forgetSession("session-a")
      serverRegistry.unregister(remoteServerId)
    }
  })
})

describe("moveSessionToDirectory", () => {
  test("moves through the control plane and reconciles directory stores", async () => {
    const message = {
      id: "message-a",
      sessionID: "session-a",
      role: "user",
      time: { created: 1 },
    } as Message
    const part = {
      id: "part-a",
      messageID: "message-a",
      type: "text",
      text: "hello",
    } as Part
    const source = createStore(
      { "session-a": [{ id: "permission-a" }] as never },
      { "session-a": [{ id: "question-a" }] as never },
      {
        session: [{ id: "session-a", title: "Move me", directory: "/source" } as Session],
        sessionTotal: 1,
        session_status: { "session-a": { type: "idle" } },
        session_diff: { "session-a": [{ file: "changed.ts", additions: 1, deletions: 0 }] },
        todo: { "session-a": [{ id: "todo-a", content: "Check move", status: "pending", priority: "medium" }] as never },
        message: { "session-a": [message] },
        part: { "message-a": [part] },
      },
    )
    const destination = createStore({})
    const childStores = createChildStores([
      ["/source", source],
      ["/destination", destination],
    ])
    const { moveSessionToDirectory, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/source")

    await moveSessionToDirectory(source.getState().session[0], "/source", "/destination", true)

    expect(sessionCalls.filter((call) => call.method === "controlPlane.moveSession")).toEqual([{
      method: "controlPlane.moveSession",
      params: {
        sessionID: "session-a",
        destination: { directory: "/destination" },
        moveChanges: true,
      },
    }])
    expect(source.getState().session).toHaveLength(0)
    expect(source.getState().sessionTotal).toBe(0)
    expect(source.getState().session_status["session-a"]).toBe(undefined)
    expect(source.getState().session_diff["session-a"]).toBe(undefined)
    expect(source.getState().todo["session-a"]).toBe(undefined)
    expect(source.getState().permission["session-a"]).toBe(undefined)
    expect(source.getState().question["session-a"]).toBe(undefined)
    expect(source.getState().message["session-a"]).toBe(undefined)
    expect(source.getState().part["message-a"]).toBe(undefined)
    expect(destination.getState().session[0]?.id).toBe("session-a")
    expect(destination.getState().sessionTotal).toBe(1)
    expect((destination.getState().session[0] as Session).directory).toBe("/destination")
    expect(destination.getState().session_status["session-a"]?.type).toBe("idle")
    expect(destination.getState().session_diff["session-a"]?.[0]?.file).toBe("changed.ts")
    expect(destination.getState().todo["session-a"]?.[0]?.content).toBe("Check move")
    expect(destination.getState().permission["session-a"]?.[0]?.id).toBe("permission-a")
    expect(destination.getState().question["session-a"]?.[0]?.id).toBe("question-a")
    expect(destination.getState().message["session-a"]?.[0]?.id).toBe("message-a")
    expect(destination.getState().part["message-a"]?.[0]?.id).toBe("part-a")
    expect(registerSessionDirectoryCalls).toEqual([{ sessionID: "session-a", directory: "/destination" }])
    expect(globalUpsertedSessions[0]?.directory).toBe("/destination")

    await moveSessionToDirectory(destination.getState().session[0], "/destination", "/source", true)

    expect(sessionCalls.filter((call) => call.method === "controlPlane.moveSession")[1]?.params.moveChanges).toBe(true)
    expect(source.getState().session[0]?.id).toBe("session-a")
    expect(source.getState().message["session-a"]?.[0]?.id).toBe("message-a")
    expect(source.getState().part["message-a"]?.[0]?.id).toBe("part-a")
    expect(destination.getState().session).toHaveLength(0)
    expect(destination.getState().message["session-a"]).toBe(undefined)
    expect(destination.getState().part["message-a"]).toBe(undefined)
  })

  test("passes moveChanges=false for descendant rollback ordering", async () => {
    const source = createStore(
      {},
      {},
      {
        session: [{ id: "session-child", title: "Child", directory: "/source" } as Session],
        sessionTotal: 1,
      },
    )
    const destination = createStore({})
    const childStores = createChildStores([
      ["/source", source],
      ["/destination", destination],
    ])
    const { moveSessionToDirectory, setActionRefs } = await import("./session-actions")
    setActionRefs(mockSdk as unknown as OpencodeClient, childStores, () => "/source")

    await moveSessionToDirectory(source.getState().session[0], "/source", "/destination", false)

    expect(sessionCalls.filter((call) => call.method === "controlPlane.moveSession")[0]?.params).toEqual({
      sessionID: "session-child",
      destination: { directory: "/destination" },
      moveChanges: false,
    })
  })
})
