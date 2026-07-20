import { describe, expect, test } from "bun:test"

import { createSessionPresenceController, isPageActivelyViewed } from "./session-presence"

describe("page view activity", () => {
  test("requires both a visible document and window focus", () => {
    expect(isPageActivelyViewed({ visibilityState: "visible", hasFocus: () => true })).toBe(true)
    expect(isPageActivelyViewed({ visibilityState: "hidden", hasFocus: () => true })).toBe(false)
    expect(isPageActivelyViewed({ visibilityState: "visible", hasFocus: () => false })).toBe(false)
  })
})

describe("session presence controller", () => {
  test("registers the focused session and unregisters it when the page becomes inactive", () => {
    let sessionId: string | null = "session-1"
    let active = true
    const sent: Array<{ action: "view" | "unview"; sessionId: string }> = []
    const controller = createSessionPresenceController({
      getSnapshot: () => ({ sessionId, active }),
      send: (action, nextSessionId) => sent.push({ action, sessionId: nextSessionId }),
    })

    controller.refresh()
    active = false
    controller.refresh()

    expect(sent).toEqual([
      { action: "view", sessionId: "session-1" },
      { action: "unview", sessionId: "session-1" },
    ])

    sessionId = null
  })

  test("moves presence atomically when the selected session changes", () => {
    let sessionId: string | null = "session-1"
    const sent: Array<{ action: "view" | "unview"; sessionId: string }> = []
    const controller = createSessionPresenceController({
      getSnapshot: () => ({ sessionId, active: true }),
      send: (action, nextSessionId) => sent.push({ action, sessionId: nextSessionId }),
    })

    controller.refresh()
    sessionId = "session-2"
    controller.refresh()

    expect(sent).toEqual([
      { action: "view", sessionId: "session-1" },
      { action: "unview", sessionId: "session-1" },
      { action: "view", sessionId: "session-2" },
    ])
  })

  test("heartbeats the current view without changing ownership", () => {
    const sent: Array<{ action: "view" | "unview"; sessionId: string }> = []
    const controller = createSessionPresenceController({
      getSnapshot: () => ({ sessionId: "session-1", active: true }),
      send: (action, sessionId) => sent.push({ action, sessionId }),
    })

    controller.refresh()
    controller.heartbeat()
    controller.dispose()

    expect(sent).toEqual([
      { action: "view", sessionId: "session-1" },
      { action: "view", sessionId: "session-1" },
      { action: "unview", sessionId: "session-1" },
    ])
  })
})
