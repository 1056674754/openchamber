import { describe, expect, test } from "bun:test"

import { MessageHistoryLoadError } from "../message-history-loader"
import { logMessageHistoryLoadFailure } from "../use-sync"

describe("logMessageHistoryLoadFailure", () => {
  test("prints a structured console error when session.messages returns 502", () => {
    const calls: unknown[][] = []
    const originalConsoleError = console.error
    console.error = (...args: unknown[]) => {
      calls.push(args)
    }

    const error = new MessageHistoryLoadError(
      "session.messages failed (502): Unexpected server error. Check server logs for details. (err_6ca69c3e)",
      502,
    )

    try {
      logMessageHistoryLoadFailure({
        sessionID: "ses_1",
        directory: "/repo/authoritative",
        serverId: "default",
        error,
      })
    } finally {
      console.error = originalConsoleError
    }

    expect(calls).toEqual([
      [
        "[sync] session.messages failed",
        {
          sessionID: "ses_1",
          directory: "/repo/authoritative",
          serverId: "default",
          status: 502,
          message: error.message,
        },
        error,
      ],
    ])
  })
})
