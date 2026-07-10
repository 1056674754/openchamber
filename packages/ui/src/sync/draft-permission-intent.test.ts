import { describe, expect, test } from "bun:test"
import {
  applyDraftPermissionIntentAfterSessionCreation,
  createDraftPermissionIntent,
} from "./draft-permission-intent"

describe("draft permission intent migration", () => {
  test("does not write session permission when auto-accept is off", async () => {
    let callCount = 0
    const setSessionAutoAccept = async (): Promise<void> => {
      callCount += 1
    }

    await applyDraftPermissionIntentAfterSessionCreation({
      sessionId: "session-manual",
      intent: createDraftPermissionIntent(false),
      setSessionAutoAccept,
    })

    expect(callCount).toBe(0)
  })

  test("writes auto-accept to the created session before returning", async () => {
    const callOrder: string[] = []
    const setSessionAutoAccept = async (sessionId: string, enabled: boolean): Promise<void> => {
      callOrder.push(`permission:${sessionId}:${enabled}`)
    }

    await applyDraftPermissionIntentAfterSessionCreation({
      sessionId: "session-created",
      intent: createDraftPermissionIntent(true),
      setSessionAutoAccept,
    })
    callOrder.push("route-first-message")

    expect(callOrder).toEqual([
      "permission:session-created:true",
      "route-first-message",
    ])
  })
})
