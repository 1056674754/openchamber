import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
    displayedPermissionMode,
    nextPermissionMode,
    permissionPolicyWireSchema,
    policySnapshotFromWire,
    resolvePermissionMode,
    type PermissionModeMap,
} from "./permissionAutoAccept"

function makeSession(id: string, parentID?: string): Session {
  return { id, parentID } as Session
}

describe("resolvePermissionMode", () => {
  test("returns ask when modes is empty", () => {
    expect(resolvePermissionMode({
      modes: {},
      sessions: [makeSession("s1")],
      sessionID: "s1",
    })).toBe("ask")
  })

  test("returns the session's own mode", () => {
    const modes: PermissionModeMap = { s1: "safety" }
    expect(resolvePermissionMode({
      modes,
      sessions: [makeSession("s1")],
      sessionID: "s1",
    })).toBe("safety")
  })

  test("inherits the nearest explicit ancestor mode", () => {
    const modes: PermissionModeMap = { grandparent: "auto" }
    const sessions = [
      makeSession("grandparent"),
      makeSession("parent", "grandparent"),
      makeSession("child", "parent"),
    ]
    expect(resolvePermissionMode({
      modes,
      sessions,
      sessionID: "child",
    })).toBe("auto")
  })

  test("a child mode overrides the parent", () => {
    const modes: PermissionModeMap = { parent: "auto", child: "ask" }
    const sessions = [
      makeSession("parent"),
      makeSession("child", "parent"),
    ]
    expect(resolvePermissionMode({
      modes,
      sessions,
      sessionID: "child",
    })).toBe("ask")
  })

  test("siblings do not inherit from each other", () => {
    const modes: PermissionModeMap = { sibling: "auto" }
    const sessions = [
      makeSession("parent"),
      makeSession("sibling", "parent"),
      makeSession("child", "parent"),
    ]
    expect(resolvePermissionMode({
      modes,
      sessions,
      sessionID: "child",
    })).toBe("ask")
  })

  test("returns ask for unknown session", () => {
    const modes: PermissionModeMap = { s1: "auto" }
    expect(resolvePermissionMode({
      modes,
      sessions: [],
      sessionID: "unknown",
    })).toBe("ask")
  })
})

describe("displayedPermissionMode", () => {
  test("shows safety as ask while no classification provider can run it", () => {
    expect(displayedPermissionMode("safety", false)).toBe("ask")
    expect(displayedPermissionMode("safety", true)).toBe("safety")
    expect(displayedPermissionMode("auto", false)).toBe("auto")
    expect(displayedPermissionMode("ask", true)).toBe("ask")
  })
})

describe("nextPermissionMode", () => {
  test("cycles ask → safety → auto → ask when the safety net is available", () => {
    expect(nextPermissionMode("ask", true)).toBe("safety")
    expect(nextPermissionMode("safety", true)).toBe("auto")
    expect(nextPermissionMode("auto", true)).toBe("ask")
  })

  test("skips safety while it is unavailable", () => {
    expect(nextPermissionMode("ask", false)).toBe("auto")
    expect(nextPermissionMode("auto", false)).toBe("ask")
    // A stored safety shows as ask and cycles from there.
    expect(nextPermissionMode("safety", false)).toBe("auto")
  })
})

describe("policySnapshotFromWire", () => {
  test("reads modes as the policy", () => {
    const parsed = permissionPolicyWireSchema.parse({ modes: { s1: "safety" }, revision: 3 })
    expect(policySnapshotFromWire(parsed)).toEqual({ modes: { s1: "safety" } })
  })

  test("maps a pre-modes on/off snapshot onto modes", () => {
    const parsed = permissionPolicyWireSchema.parse({ sessions: { s1: true, s2: false } })
    expect(policySnapshotFromWire(parsed)).toEqual({ modes: { s1: "auto", s2: "ask" } })
  })

  test("modes win over a legacy sessions view when both ride along", () => {
    const parsed = permissionPolicyWireSchema.parse({ sessions: { s1: false }, modes: { s1: "auto" } })
    expect(policySnapshotFromWire(parsed).modes.s1).toBe("auto")
  })
})
