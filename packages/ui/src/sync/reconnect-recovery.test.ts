import { describe, expect, test } from "bun:test"
import type { Message, Part, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { Session } from "@opencode-ai/sdk/v2"
import { getReconnectRecoveryPlan } from "./reconnect-recovery"

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
