import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import {
  fetchMessagePageToUserBoundary,
  hasUserBoundary,
  mergeOlderMessagePage,
  type MessagePage,
} from "../message-page-boundary"

function message(id: string, role: "user" | "assistant"): Message {
  return { id, sessionID: "ses_1", role, time: { created: 1 } } as Message
}

function textPart(id: string, messageID: string, text: string): Part {
  return { id, messageID, sessionID: "ses_1", type: "text", text } as Part
}

function page(input: {
  messages: Message[]
  parts?: Array<{ id: string; part: Part[] }>
  cursor?: string
  complete?: boolean
}): MessagePage {
  return {
    session: input.messages,
    part: input.parts ?? [],
    cursor: input.cursor,
    complete: input.complete ?? !input.cursor,
  }
}

describe("message page user boundary", () => {
  test("does not treat an assistant-only page as a user boundary", () => {
    const current = page({
      messages: [message("msg_002", "assistant"), message("msg_003", "assistant")],
      cursor: "msg_002",
    })

    expect(hasUserBoundary(current)).toBe(false)
  })

  test("stops without fetching older pages when a real user boundary is already in the page", async () => {
    const current = page({
      messages: [
        message("msg_001", "assistant"),
        message("msg_002", "user"),
        message("msg_003", "assistant"),
      ],
      parts: [{ id: "msg_002", part: [textPart("prt_002", "msg_002", "hello")] }],
      cursor: "msg_001",
    })
    const requestedCursors: string[] = []

    const result = await fetchMessagePageToUserBoundary({
      page: current,
      fetchOlder: async (cursor) => {
        requestedCursors.push(cursor)
        return page({ messages: [], complete: true })
      },
    })

    expect(requestedCursors).toEqual([])
    expect(result.extraPages).toBe(0)
    expect(result.stoppedBeforeBoundary).toBe(false)
  })

  test("becomes boundary-safe after merging an older real user message", () => {
    const current = page({
      messages: [message("msg_002", "assistant"), message("msg_003", "assistant")],
      cursor: "msg_002",
    })
    const older = page({
      messages: [message("msg_001", "user")],
      parts: [{ id: "msg_001", part: [textPart("prt_001", "msg_001", "hello")] }],
      complete: true,
    })

    const merged = mergeOlderMessagePage(current, older)

    expect(merged.session.map((item) => item.id)).toEqual(["msg_001", "msg_002", "msg_003"])
    expect(hasUserBoundary(merged)).toBe(true)
  })

  test("does not count system directive user messages as real user boundaries", () => {
    const directive = message("msg_001", "user")
    const current = page({
      messages: [directive, message("msg_002", "assistant")],
      parts: [{
        id: "msg_001",
        part: [textPart("prt_001", "msg_001", "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]\ncontinue")],
      }],
      cursor: "msg_001",
    })

    expect(hasUserBoundary(current)).toBe(false)
  })

  test("does not count skill instruction user messages as real user boundaries", () => {
    const directive = message("msg_001", "user")
    const current = page({
      messages: [directive, message("msg_002", "assistant")],
      parts: [{
        id: "msg_001",
        part: [textPart(
          "prt_001",
          "msg_001",
          "<skill-instruction>\nBase directory for this skill: /tmp/skills/example/\n\nUse the example skill.\n</skill-instruction>\n\n<user-request>\nhello\n</user-request>",
        )],
      }],
      cursor: "msg_001",
    })

    expect(hasUserBoundary(current)).toBe(false)
  })

  test("does not count delegated subtask user messages as real user boundaries", () => {
    const subtask = message("msg_001", "user")
    const current = page({
      messages: [subtask, message("msg_002", "assistant")],
      parts: [{
        id: "msg_001",
        part: [{ id: "prt_001", messageID: "msg_001", sessionID: "ses_1", type: "subtask" } as Part],
      }],
      cursor: "msg_001",
    })

    expect(hasUserBoundary(current)).toBe(false)
  })

  test("fetches older pages until the merged page contains a real user boundary", async () => {
    const current = page({
      messages: [message("msg_003", "assistant"), message("msg_004", "assistant")],
      cursor: "msg_003",
    })
    const older = page({
      messages: [message("msg_001", "user"), message("msg_002", "assistant")],
      parts: [{ id: "msg_001", part: [textPart("prt_001", "msg_001", "hello")] }],
      complete: true,
    })
    const requestedCursors: string[] = []

    const result = await fetchMessagePageToUserBoundary({
      page: current,
      fetchOlder: async (cursor) => {
        requestedCursors.push(cursor)
        return older
      },
    })

    expect(requestedCursors).toEqual(["msg_003"])
    expect(result.extraPages).toBe(1)
    expect(result.stoppedBeforeBoundary).toBe(false)
    expect(result.page.session.map((item) => item.id)).toEqual(["msg_001", "msg_002", "msg_003", "msg_004"])
  })
})
