import { describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

import { createSessionSendTool } from "./session-send.js"

type SessionFixture = {
  id: string
  title?: string
  parentID?: string
}

function makeClient(sessions: SessionFixture[]) {
  const prompt = mock(async () => ({ data: { data: { id: "msg_admitted", delivery: "queue" } } }))
  const client = {
    v2: {
      session: {
        get: mock(async (params: { sessionID: string }) => {
          const session = sessions.find((entry) => entry.id === params.sessionID)
          if (!session) throw new Error(`session not found: ${params.sessionID}`)
          return { data: { data: session } }
        }),
        prompt,
      },
    },
  }
  return { client: client as unknown as OpencodeClient, prompt }
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "ses_a",
    messageID: "msg_1",
    agent: "build",
    directory: "/repo",
    worktree: "/repo",
    abort: new AbortController().signal,
    ...overrides,
  } as ToolContext
}

describe("session_send", () => {
  test("delivers to a root session with framed message", async () => {
    const { client, prompt } = makeClient([
      { id: "ses_a", title: "Planner" },
      { id: "ses_b", title: "Implementer" },
    ])
    const tool = createSessionSendTool({ client })

    const result = await tool.execute(
      { session_id: "ses_b", message: "Status check: is the migration script done?" },
      makeContext(),
    )

    expect(prompt).toHaveBeenCalledTimes(1)
    const call = prompt.mock.calls[0] as unknown as [{ sessionID: string; prompt: { text: string }; delivery: string }]
    expect(call[0].sessionID).toBe("ses_b")
    expect(call[0].delivery).toBe("queue")
    expect(call[0].prompt.text).toContain('[message from session "Planner" (ses_a)]')
    expect(call[0].prompt.text).toContain("Status check: is the migration script done?")
    expect(call[0].prompt.text).toContain("reply with session_send to session ses_a")
    expect(result.metadata).toEqual({
      openchamberSessionMessage: {
        targetSessionID: "ses_b",
        targetTitle: "Implementer",
        sourceSessionID: "ses_a",
        delivery: "queue",
      },
    })
  })

  test("refuses self-send", async () => {
    const { client, prompt } = makeClient([{ id: "ses_a", title: "Planner" }])
    const tool = createSessionSendTool({ client })

    const result = await tool.execute({ session_id: "ses_a", message: "note to self" }, makeContext())
    expect(prompt).not.toHaveBeenCalled()
    expect(result.output).toContain("current session")
  })

  test("refuses subagent child targets", async () => {
    const { client, prompt } = makeClient([
      { id: "ses_a", title: "Planner" },
      { id: "ses_child", title: "Task child", parentID: "ses_a" },
    ])
    const tool = createSessionSendTool({ client })

    const result = await tool.execute({ session_id: "ses_child", message: "hello" }, makeContext())
    expect(prompt).not.toHaveBeenCalled()
    expect(result.output).toContain("subagent child")
  })

  test("reports unknown target ids without throwing", async () => {
    const { client, prompt } = makeClient([{ id: "ses_a", title: "Planner" }])
    const tool = createSessionSendTool({ client })

    const result = await tool.execute({ session_id: "ses_missing", message: "hello" }, makeContext())
    expect(prompt).not.toHaveBeenCalled()
    expect(result.output).toContain("ses_missing")
  })
})
