import { describe, expect, test } from "bun:test"
import {
  applyDraftPermissionIntentAfterSessionCreation,
  createDraftPermissionIntent,
} from "./draft-permission-intent"

describe("draft permission intent migration", () => {
  test("does not write a session policy for the ask default", async () => {
    let callCount = 0
    const setSessionMode = async (): Promise<void> => {
      callCount += 1
    }

    await applyDraftPermissionIntentAfterSessionCreation({
      sessionId: "session-manual",
      intent: createDraftPermissionIntent("ask"),
      setSessionMode,
    })

    expect(callCount).toBe(0)
  })

  test("writes the chosen mode to the created session before returning", async () => {
    const callOrder: string[] = []
    const setSessionMode = async (sessionId: string, mode: "ask" | "safety" | "auto"): Promise<void> => {
      callOrder.push(`permission:${sessionId}:${mode}`)
    }

    await applyDraftPermissionIntentAfterSessionCreation({
      sessionId: "session-created",
      intent: createDraftPermissionIntent("auto"),
      setSessionMode,
    })
    callOrder.push("route-first-message")

    expect(callOrder).toEqual([
      "permission:session-created:auto",
      "route-first-message",
    ])
  })
})
