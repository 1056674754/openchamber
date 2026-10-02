import { describe, expect, test } from "bun:test"
import { isOpenchamberFrame, translateV2WireEvent } from "./wire-bridge"

const wire = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type,
  id: "evt_1",
  created: 1_700_000_000_000,
  location: { directory: "/repo" },
  data,
  ...extra,
})

const types = (events: ReturnType<typeof translateV2WireEvent>) => events.map((event) => event.type)

describe("translateV2WireEvent", () => {
  test("rejects non-records and payloads without a type", () => {
    expect(translateV2WireEvent(null)).toEqual([])
    expect(translateV2WireEvent(42)).toEqual([])
    expect(translateV2WireEvent({})).toEqual([])
    expect(translateV2WireEvent({ type: "  " })).toEqual([])
  })

  test("passes OpenChamber server frames through untouched", () => {
    const frame = { type: "openchamber:message-queue.updated", properties: { items: [] } }
    expect(translateV2WireEvent(frame)).toEqual([frame])
    expect(isOpenchamberFrame(frame)).toBe(true)
    expect(isOpenchamberFrame({ type: "session.created" })).toBe(false)
  })

  test("session.created builds a v1 session record", () => {
    const [event] = translateV2WireEvent(wire("session.created", {
      sessionID: "ses_1",
      parentID: "ses_0",
      projectID: "proj_1",
      title: "hello",
      agent: "build",
    }))
    expect(event.type).toBe("session.created")
    const info = (event.properties as { info: Record<string, unknown> }).info
    expect(info.id).toBe("ses_1")
    expect(info.directory).toBe("/repo")
    expect(info.parentID).toBe("ses_0")
    expect((info.time as { created: number }).created).toBe(1_700_000_000_000)
  })

  test("partial session lifecycle events become session.patched", () => {
    expect(types(translateV2WireEvent(wire("session.renamed", { sessionID: "ses_1", title: "new" })))).toEqual([
      "session.patched",
    ])
    const [patch] = translateV2WireEvent(wire("session.renamed", { sessionID: "ses_1", title: "new" }))
    expect((patch.properties as { patch: { title: string } }).patch.title).toBe("new")

    expect(types(translateV2WireEvent(wire("session.usage.updated", { sessionID: "ses_1", cost: 2 })))).toEqual([
      "session.patched",
    ])
    expect(types(translateV2WireEvent(wire("session.model.selected", { sessionID: "ses_1", model: { providerID: "p", id: "m" } })))).toEqual([
      "session.patched",
      "message.record",
    ])
  })

  test("execution events synthesize the status vocabulary", () => {
    expect(types(translateV2WireEvent(wire("session.execution.started", { sessionID: "ses_1" })))).toEqual([
      "session.status",
    ])
    const busy = translateV2WireEvent(wire("session.execution.started", { sessionID: "ses_1" }))[0]
    expect((busy.properties as { status: { type: string } }).status.type).toBe("busy")

    const succeeded = translateV2WireEvent(wire("session.execution.succeeded", { sessionID: "ses_1" }))
    expect(types(succeeded)).toEqual(["session.status", "session.idle"])
    expect((succeeded[0].properties as { status: { type: string } }).status.type).toBe("idle")

    // A shutdown keeps the execution claim: no idle, no abort.
    expect(translateV2WireEvent(wire("session.execution.interrupted", { sessionID: "ses_1", reason: "shutdown" }))).toEqual([])

    const interrupted = translateV2WireEvent(wire("session.execution.interrupted", { sessionID: "ses_1", reason: "user" }))
    expect(types(interrupted)).toEqual(["session.status", "session.idle"])
    expect((interrupted[1].properties as { aborted: boolean }).aborted).toBe(true)

    const failed = translateV2WireEvent(wire("session.execution.failed", { sessionID: "ses_1", error: { type: "ApiError", message: "boom" } }))
    expect(types(failed)).toEqual(["session.status", "session.error"])
    expect((failed[1].properties as { error: { name: string } }).error.name).toBe("ApiError")
  })

  test("step events become message patches carrying identity", () => {
    const [started] = translateV2WireEvent(wire("session.step.started", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      agent: "build",
      model: { providerID: "p", id: "m" },
    }))
    expect(started.type).toBe("message.patched")
    const startedPatch = (started.properties as { patch: Record<string, unknown> }).patch
    expect(startedPatch.role).toBe("assistant")
    expect(startedPatch.providerID).toBe("p")
    expect(startedPatch.modelID).toBe("m")

    const [ended] = translateV2WireEvent(wire("session.step.ended", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      finish: "stop",
      cost: 1,
    }))
    const endedPatch = (ended.properties as { patch: { finish: string; retry: null; time: { completed: number } } }).patch
    expect(endedPatch.finish).toBe("stop")
    expect(endedPatch.retry).toBeNull()
    expect(endedPatch.time.completed).toBe(1_700_000_000_000)
  })

  test("retry scheduling rides the assistant message patch", () => {
    const [patch] = translateV2WireEvent(wire("session.retry.scheduled", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      attempt: 2,
      at: 123,
    }))
    expect((patch.properties as { patch: { retry: { attempt: number; at: number } } }).patch.retry).toEqual({ attempt: 2, at: 123 })
  })

  test("text and reasoning items keep (message, ordinal) part identity", () => {
    const [started] = translateV2WireEvent(wire("session.text.started", { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 1 }))
    const part = (started.properties as { part: { id: string; type: string; text: string } }).part
    expect(part.id).toBe("msg_1:text:1")
    expect(part.type).toBe("text")
    expect(part.text).toBe("")

    const [delta] = translateV2WireEvent(wire("session.text.delta", { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 1, delta: "hi" }))
    expect(delta.type).toBe("message.part.delta")
    expect(delta.properties).toMatchObject({ sessionID: "ses_1", messageID: "msg_1", partID: "msg_1:text:1", field: "text", delta: "hi" })

    const [reasoning] = translateV2WireEvent(wire("session.reasoning.delta", { sessionID: "ses_1", assistantMessageID: "msg_1", ordinal: 0, delta: "r" }))
    expect((reasoning.properties as { partID: string }).partID).toBe("msg_1:reasoning:0")
  })

  test("tool events address parts by call id", () => {
    const [input] = translateV2WireEvent(wire("session.tool.input.started", { sessionID: "ses_1", assistantMessageID: "msg_1", id: "call_1", name: "bash" }))
    const part = (input.properties as { part: { id: string; callID: string; state: { status: string } } }).part
    expect(part.id).toBe("call_1")
    expect(part.callID).toBe("call_1")
    expect(part.state.status).toBe("pending")

    const [delta] = translateV2WireEvent(wire("session.tool.input.delta", { sessionID: "ses_1", assistantMessageID: "msg_1", id: "call_1", delta: "{}" }))
    expect(delta.properties).toMatchObject({ partID: "call_1", field: "raw", delta: "{}" })

    const [called] = translateV2WireEvent(wire("session.tool.called", { sessionID: "ses_1", assistantMessageID: "msg_1", id: "call_1", input: { x: 1 }, executed: true }))
    expect(called.type).toBe("message.tool.transition")
    expect((called.properties as { transition: { kind: string } }).transition.kind).toBe("called")

    const [success] = translateV2WireEvent(wire("session.tool.success", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      id: "call_1",
      content: [{ type: "text", text: "done" }],
    }))
    const successTransition = (success.properties as { transition: { kind: string; output: string } }).transition
    expect(successTransition.kind).toBe("success")
    expect(successTransition.output).toBe("done")

    const [failed] = translateV2WireEvent(wire("session.tool.failed", {
      sessionID: "ses_1",
      assistantMessageID: "msg_1",
      id: "call_1",
      error: { type: "Error", message: "nope" },
    }))
    expect((failed.properties as { transition: { error: string } }).transition.error).toBe("nope")
  })

  test("inbox user items project a user message plus its text part", () => {
    const events = translateV2WireEvent(wire("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_u1",
      item: { type: "user", payload: { text: "hello" } },
    }))
    expect(types(events)).toEqual(["message.updated", "message.part.updated"])
    const info = (events[0].properties as { info: { role: string; id: string } }).info
    expect(info.role).toBe("user")
    expect(info.id).toBe("msg_u1")
    const part = (events[1].properties as { part: { id: string; text: string } }).part
    expect(part.id).toBe("msg_u1:text:0")
    expect(part.text).toBe("hello")

    // Synthetic inbox items are plumbing records on the side channel (S8).
    const [synthetic] = translateV2WireEvent(wire("session.inbox.enqueued", {
      sessionID: "ses_1",
      inboxID: "msg_x",
      item: { type: "synthetic", payload: { text: "x" } },
    }))
    expect(synthetic.type).toBe("message.record")
    expect((synthetic.properties as { record: { role: string; text: string } }).record).toMatchObject({
      role: "synthetic",
      text: "x",
    })
  })

  test("permission asks normalize onto the v1 field names", () => {
    const [asked] = translateV2WireEvent(wire("permission.asked", {
      id: "per_1",
      sessionID: "ses_1",
      action: "bash",
      resources: ["rm -rf"],
      save: ["always"],
    }))
    const props = asked.properties as Record<string, unknown>
    expect(props.permission).toBe("bash")
    expect(props.patterns).toEqual(["rm -rf"])
    expect(props.always).toEqual(["always"])
    // v2 fields ride along for the S7 dock.
    expect(props.action).toBe("bash")
  })

  test("v2 forms map onto the nativeForm channel", () => {
    const [created] = translateV2WireEvent(wire("form.created", { form: { id: "f_1", sessionID: "ses_1" } }))
    expect(created.type).toBe("form.created")
    expect(created.properties).toMatchObject({ sessionID: "ses_1", form: { id: "f_1" } })

    const [settled] = translateV2WireEvent(wire("form.cancelled", { sessionID: "ses_1", id: "f_1" }))
    expect(settled.type).toBe("form.settled")
    expect(settled.properties).toMatchObject({ sessionID: "ses_1", formID: "f_1" })
  })

  test("catalog announcements fold into the fork carrier", () => {
    expect(types(translateV2WireEvent(wire("provider.updated", {})))).toEqual(["catalog.updated"])
    const [model] = translateV2WireEvent(wire("model.updated", {}))
    expect((model.properties as { kind: string }).kind).toBe("model")
    expect(types(translateV2WireEvent(wire("credential.switched", {})))).toEqual(["catalog.updated"])
  })

  test("vcs and mcp notices pass through in place", () => {
    const [vcs] = translateV2WireEvent(wire("vcs.branch.updated", { branch: "main" }))
    expect(vcs.type).toBe("vcs.branch.updated")
    expect((vcs.properties as { branch: string }).branch).toBe("main")

    const [mcp] = translateV2WireEvent(wire("mcp.status.changed", { server: "context7" }))
    expect(mcp.type).toBe("mcp.status.changed")
  })

  test("plumbing, shell and compaction records ride the side channel (S8)", () => {
    const [synthetic] = translateV2WireEvent(wire("session.synthetic", { sessionID: "ses_1", text: "loop", description: "d" }, { id: "evt_9" }))
    expect(synthetic.type).toBe("message.record")
    expect((synthetic.properties as { record: Record<string, unknown> }).record).toMatchObject({
      id: "msg_9",
      role: "synthetic",
      text: "loop",
      description: "d",
    })

    const [skill] = translateV2WireEvent(wire("session.skill.activated", { sessionID: "ses_1", id: "s", name: "Skill", text: "t" }))
    expect((skill.properties as { record: Record<string, unknown> }).record).toMatchObject({ role: "skill", skill: "s", name: "Skill" })

    const [instructions] = translateV2WireEvent(wire("session.instructions.updated", { sessionID: "ses_1", text: "rule", delta: { a: 1 } }))
    expect((instructions.properties as { record: Record<string, unknown> }).record).toMatchObject({ role: "system", text: "rule" })
    // No text, no record.
    expect(translateV2WireEvent(wire("session.instructions.updated", { sessionID: "ses_1" }))).toEqual([])

    const [shellStarted] = translateV2WireEvent(wire("session.shell.started", { sessionID: "ses_1", shell: { id: "sh_1", command: "ls", status: "running" } }))
    expect((shellStarted.properties as { record: Record<string, unknown> }).record).toMatchObject({
      role: "shell",
      shellID: "sh_1",
      command: "ls",
      status: "running",
    })

    const [shellEnded] = translateV2WireEvent(wire("session.shell.ended", { sessionID: "ses_1", shell: { id: "sh_1", status: "completed", exit: 0 }, output: "out" }))
    const endedRecord = (shellEnded.properties as { record: Record<string, unknown> }).record
    expect(endedRecord).toMatchObject({ role: "shell", shellID: "sh_1", status: "completed", exit: 0, output: "out" })
    // The ended record matches the started one by shellID.
    expect(endedRecord.id).toBe("shell:sh_1")

    const [compactionStarted] = translateV2WireEvent(wire("session.compaction.started", { sessionID: "ses_1", reason: "manual" }))
    expect((compactionStarted.properties as { record: Record<string, unknown> }).record).toMatchObject({
      role: "compaction",
      compactionStatus: "running",
      summary: "",
    })

    const [compactionDelta] = translateV2WireEvent(wire("session.compaction.delta", { sessionID: "ses_1", text: "sum" }))
    expect(compactionDelta.type).toBe("message.record.delta")
    expect(compactionDelta.properties).toMatchObject({ sessionID: "ses_1", delta: "sum" })

    const [compactionEnded] = translateV2WireEvent(wire("session.compaction.ended", { sessionID: "ses_1", text: "done", cost: 3 }))
    expect((compactionEnded.properties as { record: Record<string, unknown> }).record).toMatchObject({
      role: "compaction",
      compactionStatus: "completed",
      summary: "done",
      cost: 3,
    })

    const [compactionFailed] = translateV2WireEvent(wire("session.compaction.failed", { sessionID: "ses_1", reason: "x", error: { message: "no" } }))
    expect((compactionFailed.properties as { record: Record<string, unknown> }).record).toMatchObject({
      role: "compaction",
      compactionStatus: "failed",
    })
  })

  test("unmodeled and unknown wire types drop silently", () => {
    expect(translateV2WireEvent(wire("tui.toast.show", { sessionID: "ses_1" }))).toEqual([])
    expect(translateV2WireEvent(wire("rpc.something", { sessionID: "ses_1" }))).toEqual([])
    expect(translateV2WireEvent(wire("brand.new.event", { sessionID: "ses_1" }))).toEqual([])
  })

  test("events without a session id drop where identity is required", () => {
    expect(translateV2WireEvent(wire("session.created", {}))).toEqual([])
    expect(translateV2WireEvent(wire("session.execution.started", {}))).toEqual([])
    expect(translateV2WireEvent(wire("session.step.started", { sessionID: "ses_1" }))).toEqual([])
  })
})
