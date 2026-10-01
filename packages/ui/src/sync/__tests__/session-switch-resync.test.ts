import { describe, expect, test, beforeEach, mock } from "bun:test"
import { create, type StoreApi } from "zustand"
import type { PermissionRequest } from "@opencode-ai/sdk/v2/client"
import type { FormRequest } from "@/types/form"

const scopedQuestionListCalls: string[] = []
const scopedPermissionListCalls: string[] = []
let pendingQuestionsResponse: FormRequest[] = []
let pendingPermissionsResponse: PermissionRequest[] = []
let pendingQuestionsShouldThrow = false
let pendingPermissionsShouldThrow = false

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    getDirectory: () => "/repo",
    getScopedSdkClient: () => ({
      form: {
        list: mock(async ({ directory }: { directory: string }) => {
          scopedQuestionListCalls.push(directory)
          if (pendingQuestionsShouldThrow) return { error: new Error("question.list failed: simulated") }
          return { data: pendingQuestionsResponse }
        }),
      },
      permission: {
        list: mock(async ({ directory }: { directory: string }) => {
          scopedPermissionListCalls.push(directory)
          if (pendingPermissionsShouldThrow) return { error: new Error("permission.list failed: simulated") }
          return { data: pendingPermissionsResponse }
        }),
      },
    }),
    setDirectory: () => undefined,
  },
}))

mock.module("@/stores/permissionStore", () => ({
  usePermissionStore: {
    getState: () => ({ isSessionAutoAccepting: () => false }),
  },
}))

mock.module("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => ({
      isConnected: true,
      hasEverConnected: true,
      getConnectionState: () => ({
        isConnected: true,
        hasEverConnected: true,
        connectionPhase: "connected",
        lastDisconnectReason: null,
      }),
    }),
    setState: () => undefined,
  },
}))

mock.module("@/stores/useTodosPersistStore", () => ({
  useTodosPersistStore: { getState: () => ({}) },
}))

mock.module("@/components/ui", () => ({
  toast: { info: () => undefined, error: () => undefined, success: () => undefined },
}))

import { INITIAL_STATE, type State } from "../types"
import type { DirectoryStore } from "../child-store"
import { resyncBlockingRequestsForDirectory } from "../sync-context"

function buildQuestion(overrides: Partial<FormRequest> = {}): FormRequest {
  return {
    id: "que_1",
    sessionID: "ses_a",
    questions: [{ question: "Continue?", header: "Q", options: [{ label: "Yes", description: "" }] }],
    ...overrides,
  } as FormRequest
}

function buildPermission(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "perm_1",
    sessionID: "ses_a",
    permission: "bash",
    patterns: [],
    metadata: {},
    always: [],
    ...overrides,
  } as PermissionRequest
}

function createDirectoryStore(initial: Partial<State>): StoreApi<DirectoryStore> {
  return create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    ...initial,
    session: initial.session ?? [{ id: "ses_a", title: "ses_a", time: { created: 1, updated: 1 }, version: "1" } as State["session"][number]],
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }))
}

describe("resyncBlockingRequestsForDirectory", () => {
  beforeEach(() => {
    scopedQuestionListCalls.length = 0
    scopedPermissionListCalls.length = 0
    pendingQuestionsResponse = []
    pendingPermissionsResponse = []
    pendingQuestionsShouldThrow = false
    pendingPermissionsShouldThrow = false
  })

  test("calls question.list and permission.list exactly once for the directory", async () => {
    const store = createDirectoryStore({})
    pendingQuestionsResponse = [buildQuestion()]
    pendingPermissionsResponse = [buildPermission()]

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(scopedQuestionListCalls).toEqual(["/repo"])
    expect(scopedPermissionListCalls).toEqual(["/repo"])
  })

  test("uses the directory-scoped SDK as pending-request authority", async () => {
    const store = createDirectoryStore({})

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(scopedQuestionListCalls).toEqual(["/repo"])
    expect(scopedPermissionListCalls).toEqual(["/repo"])
  })

  test("merges newly fetched questions/permissions into the directory store", async () => {
    const store = createDirectoryStore({})
    pendingQuestionsResponse = [buildQuestion()]
    pendingPermissionsResponse = [buildPermission()]

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().form["ses_a"]).toHaveLength(1)
    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_1")
    expect(store.getState().permission["ses_a"]).toHaveLength(1)
    expect(store.getState().permission["ses_a"]?.[0]?.id).toBe("perm_1")
  })

  test("recovers an explicit session before directory bootstrap materializes it", async () => {
    const store = createDirectoryStore({ session: [] })
    pendingQuestionsResponse = [buildQuestion()]

    await resyncBlockingRequestsForDirectory("/repo", store, ["ses_a"], { includePermissions: false })

    expect(scopedQuestionListCalls).toEqual(["/repo"])
    expect(scopedPermissionListCalls).toHaveLength(0)
    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_1")
  })

  test("limits explicit question recovery to the requested session", async () => {
    const store = createDirectoryStore({
      session: [
        { id: "ses_a", title: "ses_a", time: { created: 1, updated: 1 }, version: "1" },
        { id: "ses_b", title: "ses_b", time: { created: 1, updated: 1 }, version: "1" },
      ] as State["session"],
    })
    pendingQuestionsResponse = [buildQuestion(), buildQuestion({ id: "que_b", sessionID: "ses_b" })]

    await resyncBlockingRequestsForDirectory("/repo", store, ["ses_a"], { includePermissions: false })

    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_1")
    expect(store.getState().form["ses_b"]).toBe(undefined)
    expect(scopedPermissionListCalls).toHaveLength(0)
  })

  test("preserves an in-flight SSE-delivered question whose signature changed during the fetch", async () => {
    const store = createDirectoryStore({
      form: { ses_a: [{ ...buildQuestion(), id: "que_initial" }] },
    })
    pendingQuestionsResponse = []

    const promise = resyncBlockingRequestsForDirectory("/repo", store)
    store.setState({
      form: { ses_a: [{ ...buildQuestion(), id: "que_sse_arrived" }] },
    })
    await promise

    expect(store.getState().form["ses_a"]).toHaveLength(1)
    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_sse_arrived")
  })

  test("clears stale entries when API returns no pending requests and signature unchanged", async () => {
    const store = createDirectoryStore({
      form: { ses_a: [{ ...buildQuestion(), id: "que_stale" }] },
    })
    pendingQuestionsResponse = []
    pendingPermissionsResponse = []

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().form["ses_a"]).toEqual(undefined)
  })

  test("ignores questions for sessions the directory does not know about", async () => {
    const store = createDirectoryStore({})
    pendingQuestionsResponse = [{ ...buildQuestion(), sessionID: "ses_unknown" }]

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().form["ses_unknown"]).toEqual(undefined)
  })

  test("returns early without fetching when no candidate sessions are known", async () => {
    const store = createDirectoryStore({ session: [] })
    await resyncBlockingRequestsForDirectory("/repo", store)
    expect(scopedQuestionListCalls).toHaveLength(0)
    expect(scopedPermissionListCalls).toHaveLength(0)
  })

  test("preserves existing questions when listPendingQuestions throws", async () => {
    const store = createDirectoryStore({
      form: { ses_a: [{ ...buildQuestion(), id: "que_in_flight" }] },
    })
    pendingQuestionsShouldThrow = true

    const result = await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().form["ses_a"]).toHaveLength(1)
    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_in_flight")
    expect(result).toEqual({ questions: false, permissions: true })
  })

  test("preserves existing permissions when listPendingPermissions throws", async () => {
    const store = createDirectoryStore({
      permission: { ses_a: [{ ...buildPermission(), id: "perm_in_flight" }] },
    })
    pendingPermissionsShouldThrow = true

    const result = await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().permission["ses_a"]).toHaveLength(1)
    expect(store.getState().permission["ses_a"]?.[0]?.id).toBe("perm_in_flight")
    expect(result).toEqual({ forms: true, permissions: false })
  })

  test("permission fetch failure does not block question resync", async () => {
    const store = createDirectoryStore({})
    pendingQuestionsResponse = [buildQuestion()]
    pendingPermissionsShouldThrow = true

    await resyncBlockingRequestsForDirectory("/repo", store)

    expect(store.getState().form["ses_a"]).toHaveLength(1)
    expect(store.getState().form["ses_a"]?.[0]?.id).toBe("que_1")
    expect(scopedPermissionListCalls).toHaveLength(1)
  })
})
