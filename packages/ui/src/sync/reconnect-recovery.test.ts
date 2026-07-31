import { describe, expect, test } from "bun:test"
import type { Message, Part, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { Session } from "@opencode-ai/sdk/v2"
import {
  getReconnectRecoveryPlan,
  mergeBootstrapSessions,
  runReconnectMaterializations,
} from "./reconnect-recovery"

function createSession(id: string, overrides: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    time: { created: 1, updated: 1 },
    version: "1",
    ...overrides,
  } as Session
}

function createAssistantMessage(id: string, sessionID: string, completed?: number): Message {
  return {
    id,
    sessionID,
    role: "assistant",
    time: completed ? { created: 1, updated: 1, completed } : { created: 1, updated: 1 },
    parts: [],
  } as unknown as Message
}

function createPart(id: string, messageID: string): Part {
  return { id, messageID, sessionID: "active", type: "text", text: "done" } as Part
}

describe("getReconnectRecoveryPlan", () => {
  test("separates all authoritative sessions from expensive materialization candidates", () => {
    const plan = getReconnectRecoveryPlan({
      session: [
        createSession("idle"),
        createSession("busy"),
      ],
      session_status: {
        idle: { type: "idle" } as SessionStatus,
        busy: { type: "busy" } as SessionStatus,
      },
      message: {
        idle: [createAssistantMessage("m-idle", "idle", 1)],
      },
      part: {
        "m-idle": [createPart("p-idle", "m-idle")],
      },
    })

    expect(plan).toEqual({
      authoritySessionIds: ["idle", "busy"],
      materializationSessionIds: ["busy"],
    })
  })

  test("includes non-idle, incomplete assistant, and parents of candidate child sessions", () => {
    const busyStatus = { type: "busy" } as SessionStatus

    expect(getReconnectRecoveryPlan({
      session: [
        createSession("busy"),
        createSession("child", { parentID: "parent" }),
        createSession("parent"),
        createSession("incomplete"),
      ],
      session_status: { busy: busyStatus, child: busyStatus },
      message: {
        incomplete: [createAssistantMessage("m-1", "incomplete")],
      },
    }).materializationSessionIds.sort()).toEqual(["busy", "child", "incomplete", "parent"])
  })

  test("does not include parents of fully idle, renderable child sessions", () => {
    expect(getReconnectRecoveryPlan({
      session: [
        createSession("child", { parentID: "parent" }),
        createSession("parent"),
      ],
      session_status: {
        child: { type: "idle" } as SessionStatus,
        parent: { type: "idle" } as SessionStatus,
      },
      message: {
        child: [createAssistantMessage("m-1", "child", 1)],
      },
      part: {
        "m-1": [createPart("p-1", "m-1")],
      },
    }).materializationSessionIds).toEqual([])
  })

  test("includes the currently viewed session even when it looks idle and complete", () => {
    expect(getReconnectRecoveryPlan({
      session: [createSession("active")],
      session_status: { active: { type: "idle" } as SessionStatus },
      message: {
        active: [createAssistantMessage("m-1", "active", 1)],
      },
      part: {
        "m-1": [createPart("p-1", "m-1")],
      },
    }, {
      directory: "/repo",
      viewedSession: { directory: "/repo", sessionId: "active" },
    }).materializationSessionIds.sort()).toContain("active")
  })

  test("includes completed assistant sessions when the latest assistant parts are missing", () => {
    expect(getReconnectRecoveryPlan({
      session: [createSession("blank")],
      session_status: { blank: { type: "idle" } as SessionStatus },
      message: {
        blank: [createAssistantMessage("m-1", "blank", 1)],
      },
      part: {},
    }).materializationSessionIds).toEqual(["blank"])
  })

  test("does not include a viewed session from another directory", () => {
    expect(getReconnectRecoveryPlan({
      session: [createSession("active")],
      session_status: { active: { type: "idle" } as SessionStatus },
      message: {
        active: [createAssistantMessage("m-1", "active", 1)],
      },
      part: {
        "m-1": [createPart("p-1", "m-1")],
      },
    }, {
      directory: "/repo-a",
      viewedSession: { directory: "/repo-b", sessionId: "active" },
    }).materializationSessionIds.sort()).not.toContain("active")
  })
})

describe("runReconnectMaterializations", () => {
  test("reports incomplete recovery when any candidate fails to materialize", async () => {
    const attempts: string[] = []

    const completed = await runReconnectMaterializations(
      ["recovered", "failed"],
      async (sessionId) => {
        attempts.push(sessionId)
        return sessionId === "recovered"
      },
    )

    expect(attempts).toEqual(["recovered", "failed"])
    expect(completed).toBe(false)
  })
})

describe("mergeBootstrapSessions", () => {
  test("recovers a referenced parent when the roots response is temporarily empty", () => {
    const parent = createSession("parent")
    const child = createSession("child", { parentID: "parent" })

    expect(mergeBootstrapSessions([], [child], [parent])).toEqual({
      sessions: [child, parent],
      rootCount: 1,
    })
  })

  test("recovers referenced parents from the broader response without retaining stale roots", () => {
    const parent = createSession("parent")
    const stale = createSession("stale")
    const child = createSession("child", { parentID: "parent" })

    expect(mergeBootstrapSessions([], [parent, child], [stale])).toEqual({
      sessions: [child, parent],
      rootCount: 1,
    })
  })

  test("treats a successful empty response as authoritative", () => {
    const persisted = createSession("persisted")

    expect(mergeBootstrapSessions([], [], [persisted])).toEqual({
      sessions: [],
      rootCount: 0,
    })
  })

  test("preserves known children when the child-session request fails", () => {
    const cachedParent = createSession("parent")
    const authoritativeParent = createSession("parent", { title: "Current" })
    const cachedChild = createSession("child", { parentID: "parent" })

    expect(mergeBootstrapSessions([authoritativeParent], null, [cachedChild, cachedParent])).toEqual({
      sessions: [cachedChild, authoritativeParent],
      rootCount: 1,
    })
  })

  test("skips missing parents that are absent from cache and the broader response", () => {
    const orphan = createSession("orphan", { parentID: "missing-parent" })

    expect(mergeBootstrapSessions([], [orphan], [])).toEqual({
      sessions: [orphan],
      rootCount: 0,
    })
  })

  test("overlays live session events that arrive after the request starts", () => {
    const staleResponse = createSession("existing", { title: "Stale" })
    const liveUpdate = createSession("existing", { title: "Live" })
    const liveCreate = createSession("new")

    expect(mergeBootstrapSessions([staleResponse], [], [liveUpdate, liveCreate], {
      baselineRevision: 4,
      eventRevision: { existing: 5, new: 6 },
    })).toEqual({
      sessions: [liveUpdate, liveCreate],
      rootCount: 2,
    })
  })

  test("does not resurrect a session deleted after the request starts", () => {
    const deleted = createSession("deleted")

    expect(mergeBootstrapSessions([deleted], [], [], {
      baselineRevision: 2,
      deletedRevision: { deleted: 3 },
    })).toEqual({
      sessions: [],
      rootCount: 0,
    })
  })
})
