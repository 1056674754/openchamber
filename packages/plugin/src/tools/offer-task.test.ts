import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin"

import { createOfferTaskTool } from "./offer-task.js"

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "ses_source",
    messageID: "msg_1",
    agent: "build",
    directory: "/repo",
    worktree: "/repo",
    abort: new AbortController().signal,
    ...overrides,
  } as ToolContext
}

describe("offer_task", () => {
  test("emits a task card with source session and directory", async () => {
    const tool = createOfferTaskTool({
      now: () => new Date("2026-08-31T00:00:00.000Z"),
    })

    const result = await tool.execute(
      {
        title: "Fix stale README badge",
        prompt: "The README CI badge points at the old workflow name. Update it to ci.yml and verify the link resolves.",
        tldr: "Update the CI badge link in README",
      },
      makeContext(),
    )

    expect(result.title).toBe("Task card: Fix stale README badge")
    const card = (result.metadata as { openchamberTaskCard: Record<string, unknown> }).openchamberTaskCard
    expect(card.version).toBe(1)
    expect(card.sessionID).toBe("ses_source")
    expect(card.directory).toBe("/repo")
    expect(card.createdAt).toBe("2026-08-31T00:00:00.000Z")
    expect(card.prompt).toContain("README")
    expect(card.agent).toBeUndefined()
  })

  test("forwards agent when provided and omits optional fields otherwise", async () => {
    const tool = createOfferTaskTool()
    const result = await tool.execute(
      { title: "Investigate flaky test", prompt: "Run the suite 20 times and pin down the flaky assertion.", agent: "plan" },
      makeContext({ directory: "" }),
    )

    const card = (result.metadata as { openchamberTaskCard: Record<string, unknown> }).openchamberTaskCard
    expect(card.agent).toBe("plan")
    expect("tldr" in card).toBe(false)
    expect("directory" in card).toBe(false)
  })
})
