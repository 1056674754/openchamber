import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Event, OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createEventPipeline, type EventPipelineInput } from "./event-pipeline"
import { applyDirectoryEvent } from "./event-reducer"
import type { State } from "./types"

const failAfter = (ms: number) => new Promise<never>((_, reject) => {
  setTimeout(() => reject(new Error("Timed out waiting for the event pipeline flush")), ms)
})

// The pipeline constructor registers lifecycle listeners on globalThis.window;
// other sync suites replace that object with bare stubs they never restore.
// Install a complete stub for this file and put the leaked one back after.
const originalWindow = typeof globalThis !== "undefined" ? globalThis.window : undefined
const windowStub = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  location: { href: "http://localhost/", origin: "http://localhost" },
}

beforeAll(() => {
  Object.defineProperty(globalThis, "window", { value: windowStub, configurable: true, writable: true })
})

afterAll(() => {
  Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true, writable: true })
})

// ---------------------------------------------------------------------------
// Wire payloads
// ---------------------------------------------------------------------------

const v1Delta = (delta: string): Event => ({
  type: "message.part.delta",
  properties: { sessionID: "ses_1", messageID: "msg_1", partID: "prt_1", field: "text", delta },
} as Event)

const v2TextDelta = (delta: string): unknown => ({
  type: "session.text.delta",
  id: "evt_1",
  created: 1_700_000_000_000,
  location: { directory: "/repo" },
  data: { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta },
})

const v2Busy = (): unknown => ({
  type: "session.execution.started",
  id: "evt_2",
  created: 1_700_000_000_001,
  location: { directory: "/repo" },
  data: { sessionID: "ses_1" },
})

// ---------------------------------------------------------------------------
// SSE pipeline harness
// ---------------------------------------------------------------------------

function createSdk(events: unknown[], streamFinished: () => void): OpencodeClient {
  return {
    global: {
      event: async ({ signal }: { signal: AbortSignal }) => ({
        stream: (async function* () {
          for (const payload of events) {
            yield { directory: "/repo", payload }
          }
          streamFinished()
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve()
              return
            }
            signal.addEventListener("abort", () => resolve(), { once: true })
          })
        })(),
      }),
    },
  } as unknown as OpencodeClient
}

describe("event pipeline OC2 intake branch (spine S6)", () => {
  test("v1 mode (no wireMode) delivers the exact incoming payloads — zero behavior change", async () => {
    const delivered = await runPipelineWithCount({
      events: [v1Delta("a"), v1Delta("b")],
      expected: 1,
    })
    // Unchanged v1 semantics: deltas coalesce, shape untouched.
    expect(delivered).toHaveLength(1)
    expect(delivered[0].payload.type).toBe("message.part.delta")
    expect((delivered[0].payload.properties as { delta: string }).delta).toBe("ab")
  })

  test("v2 mode translates raw wire payloads into the fork vocabulary", async () => {
    const delivered = await runPipelineWithCount({
      events: [v2TextDelta("a"), v2TextDelta("b"), v2Busy()],
      expected: 2,
      wireMode: () => true,
    })
    const kinds = delivered.map((entry) => entry.payload.type)
    // The two deltas coalesce pre-flush, exactly like the v1 track.
    expect(kinds).toEqual(["message.part.delta", "session.status"])
    const delta = delivered[0].payload as unknown as { properties: { delta: string; partID: string; messageID: string } }
    expect(delta.properties.delta).toBe("ab")
    expect(delta.properties.partID).toBe("msg_1:text:0")
    const status = delivered[1].payload as unknown as { properties: { status: { type: string } } }
    expect(status.properties.status.type).toBe("busy")
  })

  test("v2 mode keeps OpenChamber server frames untouched", async () => {
    const frame = { type: "openchamber:message-queue.updated", properties: { items: [] } }
    const delivered = await runPipelineWithCount({
      events: [frame],
      expected: 1,
      wireMode: () => true,
    })
    expect(delivered[0].payload).toBe(frame as unknown as Event)
  })

  test("mixed servers: a remote-owned payload passes through raw", async () => {
    // The sync-context predicate only claims own-server (or untagged SSE)
    // events; a payload tagged for another server must stay raw here because
    // it is forwarded to the owning provider, whose intake applies that
    // server's own mode.
    const seenServerIds: (string | undefined)[] = []
    const delivered = await runPipelineWithCount({
      events: [v2TextDelta("a")],
      expected: 1,
      wireMode: (serverId) => {
        seenServerIds.push(serverId)
        return false
      },
    })
    expect(seenServerIds).toEqual([undefined]) // SSE intake: the provider's own server
    expect(delivered).toHaveLength(1)
    expect((delivered[0].payload as unknown as { type: string }).type).toBe("session.text.delta")
  })
})

async function runPipelineWithCount(options: {
  events: unknown[]
  expected: number
  wireMode?: EventPipelineInput["wireMode"]
}): Promise<{ directory: string; payload: Event; serverId?: string }[]> {
  let resolveFinished!: () => void
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve
  })
  const delivered: { directory: string; payload: Event; serverId?: string }[] = []
  const pipeline = createEventPipeline({
    sdk: createSdk(options.events, () => {
      // Flush happens on the frame timer; resolve once the consumer has seen
      // everything or the flush window passed.
      setTimeout(() => resolveFinished, 120)
    }),
    wireMode: options.wireMode,
    transport: "sse",
    onEvent: (directory, payload, meta) => {
      delivered.push({ directory, payload, ...(meta?.serverId ? { serverId: meta.serverId } : {}) })
      if (delivered.length >= options.expected) {
        resolveFinished()
      }
    },
  })
  await Promise.race([finished, failAfter(2_000)])
  pipeline.cleanup()
  return delivered
}

// ---------------------------------------------------------------------------
// Reducer bridge cases
// ---------------------------------------------------------------------------

function baseState(): State {
  return {
    session: [],
    sessionTotal: 0,
    limit: 200,
    message: {},
    part: {},
    session_status: {},
    session_activity: {},
    session_diff: {},
    permission: {},
    form: {},
    nativeForm: {},
    todo: {},
    lsp: [],
    vcs: null,
    status: "idle",
  } as unknown as State
}

const patchFrame = (frame: unknown) => frame as Parameters<typeof applyDirectoryEvent>[1]

describe("reducer bridge cases (v2-only event names)", () => {
  test("session.patched merges into the stored session without clobbering", () => {
    const draft = baseState()
    draft.session.push({ id: "ses_1", title: "old", directory: "/repo", time: { created: 1, updated: 1 } } as never)
    const changed = applyDirectoryEvent(draft, patchFrame({
      type: "session.patched",
      properties: { sessionID: "ses_1", patch: { title: "new", time: { updated: 5 } } },
    }))
    expect(changed).toBe(true)
    expect(draft.session[0]).toMatchObject({ id: "ses_1", title: "new", directory: "/repo" })
    expect((draft.session[0] as { time: { updated: number } }).time.updated).toBe(5)
  })

  test("session.patched is a no-op for an unloaded session", () => {
    const draft = baseState()
    const changed = applyDirectoryEvent(draft, patchFrame({
      type: "session.patched",
      properties: { sessionID: "ses_missing", patch: { title: "new" } },
    }))
    expect(changed).toBe(false)
  })

  test("message.patched merges step fields into the stored assistant message", () => {
    const draft = baseState()
    draft.message["ses_1"] = [{
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      parentID: "ses_1",
      modelID: "m0",
      providerID: "p0",
      mode: "",
      agent: "build",
      path: { cwd: "", root: "" },
      cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1 },
    } as never]
    const changed = applyDirectoryEvent(draft, patchFrame({
      type: "message.patched",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        patch: { finish: "stop", cost: 3, time: { completed: 9 }, retry: null },
      },
    }))
    expect(changed).toBe(true)
    const merged = draft.message["ses_1"]![0] as unknown as Record<string, unknown>
    expect(merged.finish).toBe("stop")
    expect(merged.cost).toBe(3)
    expect(merged.modelID).toBe("m0") // preserved
    expect((merged.time as { completed: number }).completed).toBe(9)
    expect("retry" in merged).toBe(false) // retry: null cleared
  })

  test("message.patched creates a minimal assistant record for a late join", () => {
    const draft = baseState()
    const changed = applyDirectoryEvent(draft, patchFrame({
      type: "message.patched",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_9",
        patch: { role: "assistant", time: { created: 3 } },
      },
    }))
    expect(changed).toBe(true)
    expect(draft.message["ses_1"]).toHaveLength(1)
    expect(draft.message["ses_1"]![0]).toMatchObject({ id: "msg_9", role: "assistant", sessionID: "ses_1" })
  })

  test("message.tool.transition merges tool state in place", () => {
    const draft = baseState()
    draft.message["ses_1"] = [{
      id: "msg_1", sessionID: "ses_1", role: "assistant", parentID: "ses_1",
      modelID: "m", providerID: "p", mode: "", agent: "build",
      path: { cwd: "", root: "" }, cost: 0,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1 },
    } as never]
    draft.part["msg_1"] = [{
      id: "call_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "tool",
      callID: "call_1",
      tool: "bash",
      state: { status: "pending", input: {}, raw: '{"x":' },
    } as never]

    const running = applyDirectoryEvent(draft, patchFrame({
      type: "message.tool.transition",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "call_1",
        transition: { kind: "called", input: { x: 1 }, executed: true, start: 10 },
      },
    }))
    expect(running).toBe(true)
    let part = draft.part["msg_1"]![0] as unknown as { state: Record<string, unknown> }
    expect(part.state.status).toBe("running")
    expect(part.state.input).toEqual({ x: 1 })

    const done = applyDirectoryEvent(draft, patchFrame({
      type: "message.tool.transition",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "call_1",
        transition: { kind: "success", output: "ok", executed: true, end: 20 },
      },
    }))
    expect(done).toBe(true)
    part = draft.part["msg_1"]![0] as unknown as { state: Record<string, unknown> }
    expect(part.state.status).toBe("completed")
    expect(part.state.output).toBe("ok")
    expect((part.state.time as { end: number }).end).toBe(20)
  })

  test("message.tool.transition for an unseen part asks for materialization", () => {
    const draft = baseState()
    const result = applyDirectoryEvent(draft, patchFrame({
      type: "message.tool.transition",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "call_x",
        transition: { kind: "called", input: {}, executed: true, start: 1 },
      },
    }))
    expect(result).not.toBe(true)
    expect(typeof result === "boolean" ? result : result.changed).toBe(false)
    if (typeof result !== "boolean") {
      expect(result.materialization.type).toBe("incomplete-session-snapshot")
    }
  })
})
