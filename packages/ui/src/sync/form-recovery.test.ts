import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { hasActiveFormToolInCurrentTurn, recoverPendingFormWithRetry } from "./form-recovery"

const message = (role: "user" | "assistant", parts: Part[] = []) => ({
  info: { id: `${role}-${parts.length}`, sessionID: "ses_1", role } as Message,
  parts,
})

const questionTool = (status: "pending" | "running" | "completed"): Part => ({
  id: `tool-${status}`,
  sessionID: "ses_1",
  messageID: "assistant-1",
  type: "tool",
  tool: "question",
  state: { status, input: {}, output: "", title: "", metadata: {}, time: { start: 1, end: status === "completed" ? 2 : undefined } },
} as Part)

describe("hasActiveFormToolInCurrentTurn", () => {
  test("detects a pending or running question in the current turn", () => {
    expect(hasActiveFormToolInCurrentTurn([message("user"), message("assistant", [questionTool("pending")])])).toBe(true)
    expect(hasActiveFormToolInCurrentTurn([message("user"), message("assistant", [questionTool("running")])])).toBe(true)
  })

  test("ignores completed questions and active questions from an older turn", () => {
    expect(hasActiveFormToolInCurrentTurn([message("assistant", [questionTool("completed")])])).toBe(false)
    expect(hasActiveFormToolInCurrentTurn([
      message("assistant", [questionTool("running")]),
      message("user"),
      message("assistant"),
    ])).toBe(false)
  })
})

describe("recoverPendingFormWithRetry", () => {
  test("retries the cold-start inconsistency with bounded delays and stops on recovery", async () => {
    const delays: number[] = []
    let attempts = 0

    const recovered = await recoverPendingFormWithRetry(
      async () => {
        attempts += 1
        return attempts === 3
      },
      { sleep: async (delayMs) => { delays.push(delayMs) } },
    )

    expect(recovered).toBe(true)
    expect(attempts).toBe(3)
    expect(delays).toEqual([500, 1500])
  })

  test("does no more work after cancellation", async () => {
    let attempts = 0
    const recovered = await recoverPendingFormWithRetry(
      async () => {
        attempts += 1
        return false
      },
      { isCancelled: () => true, sleep: async () => undefined },
    )

    expect(recovered).toBe(false)
    expect(attempts).toBe(0)
  })
})
