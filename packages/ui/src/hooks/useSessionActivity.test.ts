import { expect, mock, test } from "bun:test"

mock.module("@/sync/sync-context", () => ({
  useSessionStatus: () => undefined,
  useSessionMessages: () => [],
  useSessionPermissions: () => [],
  useSessionActivityTimestamp: () => undefined,
}))

mock.module("@/sync/session-ui-store", () => ({
  useSessionUIStore: () => null,
}))

mock.module("@/lib/messageCompletion", () => ({
  hasTerminalMessageSignal: (message: { time?: { completed?: number } }) => (
    typeof message.time?.completed === "number"
  ),
}))

test("activity fallback exposes an expiry that turns stale busy state idle", async () => {
  const module = await import("./useSessionActivity")
  const evaluator: unknown = Reflect.get(module, "getSessionActivitySnapshot")

  expect(typeof evaluator).toBe("function")
  if (typeof evaluator !== "function") return

  const input = {
    sessionId: "ses_1",
    status: { type: "idle" },
    messages: [{ id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1 } }],
    permissions: [],
    lastActivityAt: 1_000,
  }
  const beforeExpiry: unknown = evaluator({ ...input, now: 3_999 })
  const afterExpiry: unknown = evaluator({ ...input, now: 4_000 })

  expect(beforeExpiry).toEqual({
    result: { phase: "busy", isWorking: true, isBusy: true, isCooldown: false },
    expiresAt: 4_000,
  })
  expect(afterExpiry).toEqual({
    result: { phase: "idle", isWorking: false, isBusy: false, isCooldown: false },
    expiresAt: null,
  })
})

test("missing server status does not let an incomplete historical assistant stay busy forever", async () => {
  const module = await import("./useSessionActivity")
  const evaluator: unknown = Reflect.get(module, "getSessionActivitySnapshot")

  expect(typeof evaluator).toBe("function")
  if (typeof evaluator !== "function") return

  const input = {
    sessionId: "ses_1",
    messages: [{ id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1 } }],
    permissions: [],
    lastActivityAt: 1_000,
  }

  expect(evaluator({ ...input, now: 5_999 })).toEqual({
    result: { phase: "busy", isWorking: true, isBusy: true, isCooldown: false },
    expiresAt: 6_000,
  })
  expect(evaluator({ ...input, now: 6_000 })).toEqual({
    result: { phase: "idle", isWorking: false, isBusy: false, isCooldown: false },
    expiresAt: null,
  })
})
