import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { getSessionMaterializationStatus, materializeSessionSnapshots } from "../materialization"
import { INLINE_PART_PAYLOAD_CHAR_LIMIT, OPENCHAMBER_TRUNCATION_METADATA_KEY } from "../sanitize"

function message(id: string, sessionID = "ses_1"): Message {
  return { id, sessionID, role: "assistant", time: { created: 1 } } as Message
}

function userMessage(id: string, sessionID = "ses_1"): Message {
  return { id, sessionID, role: "user", time: { created: 1 } } as Message
}

function part(id: string, messageID: string, type = "text", text = id): Part {
  return { id, messageID, sessionID: "ses_1", type, text } as Part
}

function stepFinishPart(id: string, messageID: string, reason: string): Part {
  return {
    id,
    messageID,
    sessionID: "ses_1",
    type: "step-finish",
    reason,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as Part
}

describe("materializeSessionSnapshots", () => {
  test("materializes messages and parts together", () => {
    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [part("prt_1", "msg_1")] }],
    )

    expect(result.message.ses_1.map((item) => item.id)).toEqual(["msg_1"])
    expect(result.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result.messagesChanged).toBe(true)
    expect(result.partsChanged).toBe(true)
  })

  test("preserves unchanged references", () => {
    const existingMessage = message("msg_1")
    const existingPart = part("prt_1", "msg_1")
    const state = { message: { ses_1: [existingMessage] }, part: { msg_1: [existingPart] } }

    const result = materializeSessionSnapshots(
      state,
      "ses_1",
      [{ info: existingMessage, parts: [existingPart] }],
    )

    expect(result.message).toBe(state.message)
    expect(result.part).toBe(state.part)
    expect(result.messagesChanged).toBe(false)
    expect(result.partsChanged).toBe(false)
  })

  test("skips non-rendered part types", () => {
    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [part("prt_patch", "msg_1", "patch"), part("prt_text", "msg_1")] }],
      { skipPartTypes: new Set(["patch"]) },
    )

    expect(result.part.msg_1.map((item) => item.id)).toEqual(["prt_text"])
  })

  test("marks an authoritative empty assistant snapshot as renderable", () => {
    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [] }],
    )

    expect(Object.prototype.hasOwnProperty.call(result.part, "msg_1")).toBe(true)
    expect(result.part.msg_1).toEqual([])
    expect(getSessionMaterializationStatus(result, "ses_1")).toEqual({
      hasMessages: true,
      renderable: true,
      missingPartMessageIDs: [],
    })
  })

  test("promotes skipped step-finish reason onto assistant message info", () => {
    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [part("prt_text", "msg_1"), stepFinishPart("prt_finish", "msg_1", "stop")] }],
      { skipPartTypes: new Set(["step-finish"]) },
    )

    expect((result.messages[0] as { finish?: string }).finish).toBe("stop")
    expect(result.part.msg_1.map((item) => item.id)).toEqual(["prt_text"])
  })

  test("preserves newer live streaming text when a stale snapshot materializes", () => {
    const livePart = part("prt_1", "msg_1", "text", "First chunk ")
    const stalePart = part("prt_1", "msg_1", "text", "")
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: { msg_1: [livePart] },
    }

    const result = materializeSessionSnapshots(
      state,
      "ses_1",
      [{ info: message("msg_1"), parts: [stalePart] }],
    )

    expect(result.part.msg_1[0]).toBe(livePart)
    expect((result.part.msg_1[0] as { text?: string })?.text).toBe("First chunk ")
  })

  test("preserves live streaming parts omitted by a stale snapshot", () => {
    const livePart = part("prt_1", "msg_1", "text", "First chunk ")
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: { msg_1: [livePart] },
    }

    const result = materializeSessionSnapshots(
      state,
      "ses_1",
      [{ info: message("msg_1"), parts: [] }],
    )

    expect(result.part.msg_1[0]).toBe(livePart)
  })

  test("does not preserve omitted optimistic user text parts beside server snapshot parts", () => {
    const optimisticPart = { id: "prt_optimistic", messageID: "msg_1", type: "text", text: "Hello" } as Part
    const serverPart = part("prt_server", "msg_1", "text", "Hello")
    const state = {
      message: { ses_1: [userMessage("msg_1")] },
      part: { msg_1: [optimisticPart] },
    }

    const result = materializeSessionSnapshots(
      state,
      "ses_1",
      [{ info: userMessage("msg_1"), parts: [serverPart] }],
    )

    expect(result.part.msg_1).toEqual([serverPart])
  })

  test("sanitizes oversized tool payloads before retaining them in state", () => {
    const toolPart: Part = {
      id: "prt_tool",
      messageID: "msg_1",
      sessionID: "ses_1",
      type: "tool",
      callID: "call_1",
      tool: "apply_patch",
      state: {
        status: "completed",
        input: {},
        output: "done",
        title: "Apply patch",
        metadata: { patch: "x".repeat(INLINE_PART_PAYLOAD_CHAR_LIMIT + 1) },
        time: { start: 1, end: 2 },
      },
    }

    const result = materializeSessionSnapshots(
      { message: {}, part: {} },
      "ses_1",
      [{ info: message("msg_1"), parts: [toolPart] }],
    )

    const retained = result.part.msg_1[0]
    expect(retained?.type).toBe("tool")
    if (!retained || retained.type !== "tool") throw new Error("expected retained tool part")
    expect(retained.metadata?.[OPENCHAMBER_TRUNCATION_METADATA_KEY]).toEqual({
      fields: ["state.metadata"],
      limit: INLINE_PART_PAYLOAD_CHAR_LIMIT,
    })
  })
})

describe("getSessionMaterializationStatus", () => {
  test("requires assistant parts for renderable cached state", () => {
    const state = {
      message: { ses_1: [message("msg_1")] },
      part: {},
    }

    expect(getSessionMaterializationStatus(state, "ses_1")).toEqual({
      hasMessages: true,
      renderable: false,
      missingPartMessageIDs: ["msg_1"],
    })
  })

  test("treats user-only cached state as renderable", () => {
    const state = {
      message: { ses_1: [{ ...message("msg_1"), role: "user" } as Message] },
      part: {},
    }

    expect(getSessionMaterializationStatus(state, "ses_1")).toEqual({
      hasMessages: true,
      renderable: true,
      missingPartMessageIDs: [],
    })
  })
})
