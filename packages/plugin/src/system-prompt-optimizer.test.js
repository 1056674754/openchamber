import { describe, expect, test } from "bun:test"

import { createSystemPromptOptimizer } from "./system-prompt-optimizer.ts"

const createClient = (agents) => ({
  app: {
    agents: async () => ({ data: agents }),
  },
})

describe("system prompt optimizer", () => {
  test.each([
    ["build", "builtIn"],
    ["plan", "native"],
  ])("optimizes the built-in %s route and preserves structural context", async (agent, marker) => {
    const optimizer = createSystemPromptOptimizer({
      client: createClient([{ name: agent, [marker]: true }]),
      directory: "/workspace",
      enabled: true,
    })
    const providerBoundary = "You are powered by the model named TEST."
    const output = {
      system: [
        "PREFIX_TO_REMOVE",
        `${providerBoundary}\n<env>ENV_MARKER</env>\n<project>PROJECT_MARKER</project>`,
      ],
    }

    await optimizer.chatMessage(
      { sessionID: "session-1", agent },
      { message: { agent } },
    )
    await optimizer.transform({ sessionID: "session-1" }, output)

    expect(output.system).toHaveLength(1)
    expect(output.system[0]).not.toContain("PREFIX_TO_REMOVE")
    expect(output.system[0]).toContain(providerBoundary)
    expect(output.system[0]).toContain("<env>ENV_MARKER</env>")
    expect(output.system[0]).toContain("<project>PROJECT_MARKER</project>")
  })

  test("leaves disabled and custom agents unchanged", async () => {
    const original = "CUSTOM_MARKER\nYou are powered by the model named TEST."
    for (const enabled of [false, true]) {
      const optimizer = createSystemPromptOptimizer({
        client: createClient([{ name: "build", builtIn: false }]),
        directory: "/workspace",
        enabled,
      })
      const output = { system: [original] }
      await optimizer.chatMessage(
        { sessionID: `session-${enabled}`, agent: "build" },
        { message: { agent: "build" } },
      )
      await optimizer.transform({ sessionID: `session-${enabled}` }, output)
      expect(output.system).toEqual([original])
    }
  })

  test("fails closed after agent switching, unknown boundaries, and registry failures", async () => {
    const optimizer = createSystemPromptOptimizer({
      client: createClient([
        { name: "build", builtIn: true },
        { name: "review", builtIn: false },
      ]),
      directory: "/workspace",
      enabled: true,
    })
    const original = "PREFIX\nYou are powered by the model named TEST."
    const switched = { system: [original] }
    await optimizer.chatMessage(
      { sessionID: "switched", agent: "build" },
      { message: { agent: "build" } },
    )
    await optimizer.chatMessage(
      { sessionID: "switched", agent: "review" },
      { message: { agent: "review" } },
    )
    await optimizer.transform({ sessionID: "switched" }, switched)
    expect(switched.system).toEqual([original])

    const unknown = { system: ["UNRECOGNIZED_FORMAT"] }
    await optimizer.chatMessage(
      { sessionID: "unknown", agent: "build" },
      { message: { agent: "build" } },
    )
    await optimizer.transform({ sessionID: "unknown" }, unknown)
    expect(unknown.system).toEqual(["UNRECOGNIZED_FORMAT"])

    const unavailable = createSystemPromptOptimizer({
      client: {
        app: {
          agents: async () => {
            throw new Error("unavailable")
          },
        },
      },
      directory: "/workspace",
      enabled: true,
    })
    const failed = { system: [original] }
    await unavailable.chatMessage(
      { sessionID: "failed", agent: "build" },
      { message: { agent: "build" } },
    )
    await unavailable.transform({ sessionID: "failed" }, failed)
    expect(failed.system).toEqual([original])
  })
})
