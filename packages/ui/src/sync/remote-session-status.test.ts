import { describe, expect, test } from "bun:test"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"

import { createRemoteSessionStatusReader } from "./remote-session-status"
import { RemoteReadScheduler } from "./remote-read-scheduler"

describe("createRemoteSessionStatusReader", () => {
  test("shares one status request across concurrent callers", async () => {
    const scheduler = new RemoteReadScheduler(3)
    let calls = 0
    const reader = createRemoteSessionStatusReader({
      scheduler,
      load: async () => {
        calls += 1
        await Promise.resolve()
        return { session: { type: "busy" } satisfies SessionStatus }
      },
    })

    const [first, second] = await Promise.all([
      reader.read("remote-a", "/repo"),
      reader.read("remote-a", "/repo"),
    ])

    expect(first).toEqual({ session: { type: "busy" } })
    expect(second).toBe(first)
    expect(calls).toBe(1)
  })
})
