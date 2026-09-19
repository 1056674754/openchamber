import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { AttachedFile } from "./types/sessionTypes"
import type { MessageQueueUpdatedEvent } from "./messageQueueStore"

type FetchCall = { path: string; method: string; body: ReturnType<typeof JSON.parse> }
let calls: FetchCall[] = []
let isVSCode = false
let respond: (call: FetchCall) => Response = () => new Response("{}", { status: 200 })

mock.module("@/lib/runtime-fetch", () => ({
  runtimeFetch: async (path: string, init?: RequestInit) => {
    const call = {
      path,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    calls.push(call)
    return respond(call)
  },
}))
const desktop = await import("@/lib/desktop")
mock.module("@/lib/desktop", () => ({ ...desktop, isVSCodeRuntime: () => isVSCode }))
mock.module("@/lib/persistence", () => ({ updateDesktopSettings: async () => undefined }))

const {
  applyMessageQueueUpdatedEvent,
  useMessageQueueStore,
} = await import("./messageQueueStore")

type ServerItem = MessageQueueUpdatedEvent["properties"]["session"]["items"][number]
type ServerSession = MessageQueueUpdatedEvent["properties"]["session"]

type ServerReply = {
  revision: number
  session?: ServerSession
  sessions?: ServerSession[]
  item?: ServerItem
  items?: ServerItem[]
}

const json = (value: ServerReply, status = 200) => new Response(JSON.stringify(value), { status })

const SESSION = "session-1"

const serverItem = (id: string, content: string, extra: Partial<ServerItem> = {}): ServerItem => ({
  id,
  createdAt: 1,
  content,
  text: content,
  attachments: [],
  sendConfig: { providerID: "p", modelID: "m" },
  ...extra,
})

const issueMetadata = { openchamberContext: { kind: "github-issue" as const, number: 3, title: "Bug", url: "https://x/issues/3" } }

const session = (items: ServerItem[], sendingId: string | null = null): ServerSession => ({
  sessionId: SESSION,
  directory: "/repo",
  items,
  sendingId,
})

const updated = (revision: number, updatedSession: ServerSession): MessageQueueUpdatedEvent => ({
  type: "openchamber:message-queue.updated",
  properties: { revision, session: updatedSession },
})

const attachment: AttachedFile = {
  id: "att-1",
  file: new File(["hi"], "note.txt", { type: "text/plain" }),
  dataUrl: "data:text/plain;base64,aGk=",
  mimeType: "text/plain",
  filename: "note.txt",
  size: 2,
  source: "local",
}

beforeEach(() => {
  isVSCode = false
  calls = []
  respond = () => json({ revision: 1, session: session([]) })
  // Forgetting also drops the revision guard, so each test starts unordered.
  useMessageQueueStore.getState().forgetQueue(SESSION)
  useMessageQueueStore.setState({ queuedMessages: {}, sendingIds: {} })
})

describe("server-owned message queue", () => {
  test("hydrate uploads messages queued by an older build before reading the server", async () => {
    useMessageQueueStore.setState({
      queuedMessages: {
        [SESSION]: [{
          id: "local-1",
          content: "from before",
          createdAt: 1,
          sendTarget: { directory: "/repo" },
          sendConfig: { providerID: "p", modelID: "m" },
        }],
      },
    })
    respond = (call) => (call.method === "POST"
      ? json({ revision: 2, session: session([serverItem("q1", "from before")]) })
      : json({ revision: 2, sessions: [session([serverItem("q1", "from before")])] }))
    await useMessageQueueStore.getState().hydrate()

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/message-queue/sessions/session-1/items",
      body: { directory: "/repo", item: { content: "from before", text: "from before", attachments: [], context: [], sendConfig: { providerID: "p", modelID: "m" } } },
    })
    expect(calls[1]?.path).toBe("/api/message-queue")
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.id)).toEqual(["q1"])
  })

  test("hydrate replaces the projection with the server queue", async () => {
    respond = () => json({ revision: 3, sessions: [session([serverItem("q1", "hello")], "q1")] })
    await useMessageQueueStore.getState().hydrate()

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /api/message-queue"])
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["hello"])
    expect(useMessageQueueStore.getState().sendingIds[SESSION]).toEqual(["q1"])
  })

  test("context-only queue previews survive authoritative snapshots", async () => {
    respond = () => json({ revision: 3, sessions: [session([serverItem("q1", "", { contextPreview: "Explain this quote" })])] })
    await useMessageQueueStore.getState().hydrate()
    const queued = useMessageQueueStore.getState().queuedMessages[SESSION]?.[0]
    expect(queued?.contextPreview).toBe("Explain this quote")
    expect(queued?.content).toBe("")
    expect(queued?.context).toBeUndefined()
  })

  test("addToQueue shows the message at once and settles on the server's copy", async () => {
    respond = () => json({ revision: 5, session: session([serverItem("srv-1", "hi @reviewer", { agentMention: "reviewer" })]) })
    const pending = useMessageQueueStore.getState().addToQueue(SESSION, {
      content: "hi @reviewer",
      text: "hi",
      agentMention: "reviewer",
      attachments: [attachment],
      sendTarget: { directory: "/repo" },
      sendConfig: { providerID: "p", modelID: "m", agent: "build" },
    })
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]).toHaveLength(1)
    await pending

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/message-queue/sessions/session-1/items",
      body: {
        directory: "/repo",
        item: {
          content: "hi @reviewer",
          text: "hi",
          agentMention: "reviewer",
          attachments: [{ id: "att-1", filename: "note.txt", mimeType: "text/plain", size: 2, source: "local", dataUrl: attachment.dataUrl }],
          context: [],
          sendConfig: { providerID: "p", modelID: "m", agent: "build" },
        },
      },
    })
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.id)).toEqual(["srv-1"])
  })

  test("addToQueue hands the captured context to the server, and a take brings it back", async () => {
    const context = [
      { kind: "context" as const, text: "issue body", metadata: issueMetadata },
      { kind: "synthetic" as const, text: "conflict payload" },
    ]
    respond = () => json({ revision: 6, session: session([serverItem("srv-1", "with context")]) })
    await useMessageQueueStore.getState().addToQueue(SESSION, {
      content: "with context",
      context,
      sendTarget: { directory: "/repo" },
      sendConfig: { providerID: "p", modelID: "m" },
    })
    expect(calls[0]?.body.item.context).toEqual(context)
    expect(calls[0]?.body.item.contextPreview).toBe("Bug")
    // The projection carries no context; the server strips payloads from snapshots.
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.[0]?.context).toBe(undefined)

    respond = () => json({ revision: 7, session: session([]), item: serverItem("srv-1", "with context", { context }) })
    const [taken] = await useMessageQueueStore.getState().takeForSend(SESSION, "srv-1")
    expect(taken?.context).toEqual(context)
    expect(taken?.text).toBe("with context")
  })

  test("a server item with malformed context is rejected at the boundary", async () => {
    respond = () => new Response(JSON.stringify({
      revision: 8,
      session: session([]),
      item: { ...serverItem("srv-1", "x"), context: [{ kind: "context", text: "x", metadata: { openchamberContext: { kind: "nope" } } }] },
    }), { status: 200 })
    await expect(useMessageQueueStore.getState().takeForSend(SESSION, "srv-1")).rejects.toThrow()
  })

  test("addToQueue rolls the optimistic entry back when the server refuses", async () => {
    respond = () => new Response("nope", { status: 500 })
    await expect(useMessageQueueStore.getState().addToQueue(SESSION, {
      content: "x",
      sendTarget: { directory: "/repo" },
      sendConfig: { providerID: "p", modelID: "m" },
    })).rejects.toThrow()
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]).toBe(undefined)
  })

  test("addToQueue refuses a message with no captured model", async () => {
    await expect(useMessageQueueStore.getState().addToQueue(SESSION, { content: "x" })).rejects.toThrow()
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]).toBe(undefined)
    expect(calls).toHaveLength(0)
  })

  test("takeForSend brings the full message back, attachments included", async () => {
    respond = () => json({
      revision: 7,
      session: session([]),
      item: serverItem("q1", "with file", {
        attachments: [{ id: "att-1", filename: "note.txt", mimeType: "text/plain", size: 2, source: "local", dataUrl: "data:text/plain;base64,aGk=" }],
      }),
    })
    const [taken] = await useMessageQueueStore.getState().takeForSend(SESSION, "q1")

    expect(calls[0]?.path).toBe("/api/message-queue/sessions/session-1/items/q1/take")
    expect(calls[0]?.method).toBe("POST")
    expect(taken?.content).toBe("with file")
    expect(taken?.attachments?.[0]?.dataUrl).toBe("data:text/plain;base64,aGk=")
    expect(taken?.attachments?.[0]?.file.size).toBe(2)
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]).toBe(undefined)
  })

  test("takeForSend without an id takes everything the server is not already sending", async () => {
    respond = () => json({ revision: 8, session: session([serverItem("q1", "in flight")], "q1"), items: [serverItem("q2", "second")] })
    const taken = await useMessageQueueStore.getState().takeForSend(SESSION)

    expect(calls[0]?.path).toBe("/api/message-queue/sessions/session-1/take")
    expect(calls[0]?.method).toBe("POST")
    expect(taken.map((m) => m.content)).toEqual(["second"])
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.id)).toEqual(["q1"])
  })

  test("broadcasts update the projection but never move it backwards", () => {
    applyMessageQueueUpdatedEvent(updated(4, session([serverItem("q1", "newer")])))
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["newer"])

    applyMessageQueueUpdatedEvent(updated(2, session([serverItem("q0", "older")])))
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["newer"])

    applyMessageQueueUpdatedEvent(updated(9, session([serverItem("q2", "later")])))
    applyMessageQueueUpdatedEvent(updated(3, { sessionId: SESSION, directory: "", items: [], sendingId: null }))
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["later"])
  })

  test("removeFromQueue and clearQueue update locally and tell the server", async () => {
    useMessageQueueStore.setState({ queuedMessages: { [SESSION]: [{ id: "q1", content: "a", text: "a", createdAt: 1 }, { id: "q2", content: "b", text: "b", createdAt: 2 }] } })
    respond = () => json({ revision: 10, session: session([serverItem("q2", "b")]) })
    useMessageQueueStore.getState().removeFromQueue(SESSION, "q1")
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.id)).toEqual(["q2"])
    await Promise.resolve()
    await Promise.resolve()
    expect(calls[0]).toEqual({ method: "DELETE", path: "/api/message-queue/sessions/session-1/items/q1", body: undefined })

    respond = () => json({ revision: 11, session: session([]) })
    useMessageQueueStore.getState().clearQueue(SESSION)
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]).toBe(undefined)
    await Promise.resolve()
    expect(calls[1]).toEqual({ method: "DELETE", path: "/api/message-queue/sessions/session-1", body: undefined })
  })

  test("reorderQueue sends the complete new order", async () => {
    useMessageQueueStore.setState({ queuedMessages: { [SESSION]: [{ id: "q1", content: "a", text: "a", createdAt: 1 }, { id: "q2", content: "b", text: "b", createdAt: 2 }] } })
    respond = () => json({ revision: 12, session: session([serverItem("q2", "b"), serverItem("q1", "a")]) })
    useMessageQueueStore.getState().reorderQueue(SESSION, "q2", "q1")
    await Promise.resolve()
    expect(calls[0]).toEqual({ method: "PUT", path: "/api/message-queue/sessions/session-1/order", body: { itemIds: ["q2", "q1"] } })
  })

  test("VS Code keeps its local queue and never calls the server", async () => {
    isVSCode = true
    useMessageQueueStore.setState({ queuedMessages: { [SESSION]: [{ id: "q1", content: "local", createdAt: 1, sendConfig: { providerID: "p", modelID: "m" }, sendTarget: { directory: "/repo" } }] } })
    await useMessageQueueStore.getState().addToQueue(SESSION, { content: "local two", sendConfig: { providerID: "p", modelID: "m" } })

    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["local", "local two"])
    expect(calls).toHaveLength(0)

    const [taken] = await useMessageQueueStore.getState().takeForSend(SESSION, "q1")
    expect(taken?.content).toBe("local")
    expect(useMessageQueueStore.getState().queuedMessages[SESSION]?.map((m) => m.content)).toEqual(["local two"])
  })
})
