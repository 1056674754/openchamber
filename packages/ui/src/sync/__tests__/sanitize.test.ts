import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"

import {
  INLINE_PART_PAYLOAD_CHAR_LIMIT,
  OPENCHAMBER_TRUNCATION_METADATA_KEY,
  sanitizePartPayload,
} from "../sanitize"

function completedToolPart(input?: {
  readonly output?: string
  readonly stateMetadata?: Record<string, unknown>
}): Part {
  return {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "apply_patch",
    state: {
      status: "completed",
      input: {},
      output: input?.output ?? "done",
      title: "Apply patch",
      metadata: input?.stateMetadata ?? {},
      time: { start: 1, end: 2 },
    },
  }
}

describe("sanitizePartPayload", () => {
  test("preserves the original part reference when the payload is within budget", () => {
    const part = completedToolPart({ stateMetadata: { files: 2 } })

    expect(sanitizePartPayload(part)).toBe(part)
  })

  test("replaces oversized tool metadata with an explicit truncation marker", () => {
    const part = completedToolPart({
      stateMetadata: { patch: "x".repeat(INLINE_PART_PAYLOAD_CHAR_LIMIT + 1) },
    })

    const sanitized = sanitizePartPayload(part)

    expect(sanitized.type).toBe("tool")
    if (sanitized.type !== "tool") throw new Error("expected tool part")
    expect(sanitized.state.status).toBe("completed")
    if (sanitized.state.status !== "completed") throw new Error("expected completed tool state")
    expect(sanitized.state.metadata).toEqual({})
    expect(sanitized.metadata?.[OPENCHAMBER_TRUNCATION_METADATA_KEY]).toEqual({
      fields: ["state.metadata"],
      limit: INLINE_PART_PAYLOAD_CHAR_LIMIT,
    })
  })

  test("caps oversized tool output and records which field was truncated", () => {
    const part = completedToolPart({
      output: "x".repeat(INLINE_PART_PAYLOAD_CHAR_LIMIT + 1),
    })

    const sanitized = sanitizePartPayload(part)

    expect(sanitized.type).toBe("tool")
    if (sanitized.type !== "tool") throw new Error("expected tool part")
    expect(sanitized.state.status).toBe("completed")
    if (sanitized.state.status !== "completed") throw new Error("expected completed tool state")
    expect(sanitized.state.output).toHaveLength(INLINE_PART_PAYLOAD_CHAR_LIMIT)
    expect(sanitized.metadata?.[OPENCHAMBER_TRUNCATION_METADATA_KEY]).toEqual({
      fields: ["state.output"],
      limit: INLINE_PART_PAYLOAD_CHAR_LIMIT,
    })
  })

  test("handles oversized metadata arrays without spreading them onto the call stack", () => {
    const part = completedToolPart({
      stateMetadata: { values: Array.from({ length: 250_000 }, () => "123") },
    })

    const sanitized = sanitizePartPayload(part)

    expect(sanitized.type).toBe("tool")
    if (sanitized.type !== "tool") throw new Error("expected tool part")
    expect(sanitized.state.status).toBe("completed")
    if (sanitized.state.status !== "completed") throw new Error("expected completed tool state")
    expect(sanitized.state.metadata).toEqual({})
    expect(sanitized.metadata?.[OPENCHAMBER_TRUNCATION_METADATA_KEY]).toEqual({
      fields: ["state.metadata"],
      limit: INLINE_PART_PAYLOAD_CHAR_LIMIT,
    })
  })
})
