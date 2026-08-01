import { describe, expect, test } from "bun:test"
import type { Event, Part, PermissionRequest, QuestionRequest, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { applyDirectoryEvent } from "../event-reducer"
import { INITIAL_STATE, type State } from "../types"

function state(overrides: Partial<State> = {}): State {
  return {
    ...INITIAL_STATE,
    message: {},
    part: {},
    session_status: {},
    ...overrides,
  }
}

function deltaEvent(): Event {
  return {
    type: "message.part.delta",
    properties: {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "prt_1",
      field: "text",
      delta: "hello",
    },
  } as Event
}

function partUpdatedEvent(): Event {
  return {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_1",
      part: {
        id: "prt_1",
        messageID: "msg_1",
        type: "text",
        text: "hello",
      },
    },
  } as Event
}

describe("applyDirectoryEvent", () => {
  test("does not let a stale session update overwrite a newer title", () => {
    const current = {
      id: "ses_1",
      title: "New Title",
      time: { created: 1, updated: 20 },
    } as Session
    const incoming = {
      ...current,
      title: "Old Title",
      time: { created: 1, updated: 10 },
    } as Session
    const draft = state({ session: [current] })

    expect(applyDirectoryEvent(draft, {
      type: "session.updated",
      properties: { info: incoming },
    } as Event)).toBe(false)
    expect(draft.session[0]).toBe(current)
  })

  test("returns typed materialization when delta arrives before parts", () => {
    const result = applyDirectoryEvent(state(), deltaEvent())

    expect(result).toEqual({
      changed: false,
      materialization: { type: "incomplete-session-snapshot", sessionID: "ses_1", messageID: "msg_1", partID: "prt_1" },
    })
  })

  test("returns typed materialization when delta part is missing", () => {
    const result = applyDirectoryEvent(
      state({ part: { msg_1: [{ id: "prt_2", messageID: "msg_1", type: "text", text: "" } as Part] } }),
      deltaEvent(),
    )

    expect(result).toEqual({
      changed: false,
      materialization: { type: "incomplete-session-snapshot", sessionID: "ses_1", messageID: "msg_1", partID: "prt_1" },
    })
  })

  test("applies part update and requests materialization when owning message is absent", () => {
    const draft = state()
    const result = applyDirectoryEvent(draft, partUpdatedEvent())

    expect(draft.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result).toEqual({
      changed: true,
      materialization: {
        type: "incomplete-session-snapshot",
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "prt_1",
      },
    })
  })

  test("uses event sessionID for part update materialization when part omits it", () => {
    const draft = state()
    const result = applyDirectoryEvent(draft, {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_from_event",
        part: {
          id: "prt_1",
          messageID: "msg_1",
          type: "text",
          text: "hello",
        },
      },
    } as Event)

    expect(typeof draft.session_activity.ses_from_event).toBe("number")
    expect(result).toEqual({
      changed: true,
      materialization: {
        type: "incomplete-session-snapshot",
        sessionID: "ses_from_event",
        messageID: "msg_1",
        partID: "prt_1",
      },
    })
  })

  test("uses event sessionID for delta materialization when parts are missing", () => {
    const result = applyDirectoryEvent(state(), {
      type: "message.part.delta",
      properties: {
        sessionID: "ses_from_event",
        messageID: "msg_1",
        partID: "prt_1",
        field: "text",
        delta: "hello",
      },
    } as Event)

    expect(result).toEqual({
      changed: false,
      materialization: {
        type: "incomplete-session-snapshot",
        sessionID: "ses_from_event",
        messageID: "msg_1",
        partID: "prt_1",
      },
    })
  })

  test("message.part.delta preserves session and session_status references (subscribe filtering invariant)", () => {
    const draft = state({
      session: [{ id: "ses_1", title: "Test", time: { created: 1, updated: 1 } } as Session],
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      part: { msg_1: [{ id: "prt_1", messageID: "msg_1", type: "text", text: "" } as Part] },
    })
    const sessionRef = draft.session
    const statusRef = draft.session_status

    const result = applyDirectoryEvent(draft, deltaEvent())
    expect(result).toBe(true)
    // multi-server-hooks.ts subscribes with slice-reference filtering:
    //   if (state.session !== prevState.session) listener()
    // This optimization is only correct if message.part.delta never reassigns
    // draft.session or draft.session_status. Lock that invariant here.
    expect(draft.session).toBe(sessionRef)
    expect(draft.session_status).toBe(statusRef)
  })

  test("applies part update without materialization when owning message exists", () => {
    const draft = state({
      message: { ses_1: [{ id: "msg_1", sessionID: "ses_1", role: "assistant", time: { created: 1 } } as never] },
    })
    const result = applyDirectoryEvent(draft, partUpdatedEvent())

    expect(draft.part.msg_1.map((item) => item.id)).toEqual(["prt_1"])
    expect(result).toBe(true)
  })

  test("skips duplicate session status events", () => {
    const draft = state()
    const busyStatus = { type: "busy" } as SessionStatus
    const event = {
      type: "session.status",
      properties: { sessionID: "ses_1", status: busyStatus },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("skips duplicate session idle events", () => {
    const draft = state()
    const event = {
      type: "session.idle",
      properties: { sessionID: "ses_1" },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("skips duplicate session error idle-state events", () => {
    const draft = state()
    const event = {
      type: "session.error",
      properties: { sessionID: "ses_1" },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    const statusRef = draft.session_status.ses_1

    expect(applyDirectoryEvent(draft, event)).toBe(false)
    expect(draft.session_status.ses_1).toBe(statusRef)
  })

  test("detects retry status metadata changes", () => {
    const draft = state({
      session_status: {
        ses_1: { type: "retry", attempt: 1, message: "rate limited", next: 10 } as SessionStatus,
      },
    })

    const event = {
      type: "session.status",
      properties: {
        sessionID: "ses_1",
        status: { type: "retry", attempt: 2, message: "rate limited", next: 20 } as SessionStatus,
      },
    } as Event

    expect(applyDirectoryEvent(draft, event)).toBe(true)
    expect((draft.session_status.ses_1 as Extract<SessionStatus, { type: "retry" }>).attempt).toBe(2)
  })

  test("deletes sessions from sessionID-only payloads", () => {
    const draft = state({
      session: [{ id: "ses_1", title: "Existing", time: { created: 1, updated: 1 } } as never],
      sessionTotal: 1,
      message: { ses_1: [{ id: "msg_1", sessionID: "ses_1", role: "user", time: { created: 1 } } as never] },
      part: { msg_1: [{ id: "prt_1", messageID: "msg_1", type: "text", text: "hello" } as Part] },
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      session_activity: { ses_1: 123 },
    })

    const result = applyDirectoryEvent(draft, {
      type: "session.deleted",
      properties: { sessionID: "ses_1" },
    } as Event)

    expect(result).toBe(true)
    expect(draft.session).toEqual([])
    expect(draft.sessionTotal).toBe(0)
    expect(draft.message.ses_1).toBe(undefined)
    expect(draft.part.msg_1).toBe(undefined)
    expect(draft.session_status.ses_1).toBe(undefined)
    expect(draft.session_activity.ses_1).toBe(undefined)
  })

  test("skips missing message removal events", () => {
    const draft = state()

    const result = applyDirectoryEvent(draft, {
      type: "message.removed",
      properties: { sessionID: "ses_1", messageID: "msg_missing" },
    } as Event)

    expect(result).toBe(false)
    expect(draft.message).toEqual({})
    expect(draft.part).toEqual({})
  })

  test("updates permission request arrays immutably", () => {
    const initialPermissions = [
      { id: "perm_1", sessionID: "ses_1" } as PermissionRequest,
    ]
    const draft = state({ permission: { ses_1: initialPermissions } })

    applyDirectoryEvent(draft, {
      type: "permission.asked",
      properties: { id: "perm_2", sessionID: "ses_1" } as PermissionRequest,
    } as Event)

    expect(draft.permission.ses_1).not.toBe(initialPermissions)
    expect(draft.permission.ses_1.map((item) => item.id)).toEqual(["perm_1", "perm_2"])

    const afterAsk = draft.permission.ses_1
    applyDirectoryEvent(draft, {
      type: "permission.replied",
      properties: { sessionID: "ses_1", requestID: "perm_1" },
    } as Event)

    expect(draft.permission.ses_1).not.toBe(afterAsk)
    expect(draft.permission.ses_1.map((item) => item.id)).toEqual(["perm_2"])
  })

  test("updates question request arrays immutably", () => {
    const initialQuestions = [
      { id: "ques_1", sessionID: "ses_1" } as QuestionRequest,
    ]
    const draft = state({ question: { ses_1: initialQuestions } })

    applyDirectoryEvent(draft, {
      type: "question.asked",
      properties: { id: "ques_2", sessionID: "ses_1" } as QuestionRequest,
    } as Event)

    expect(draft.question.ses_1).not.toBe(initialQuestions)
    expect(draft.question.ses_1.map((item) => item.id)).toEqual(["ques_1", "ques_2"])

    const replacement = {
      id: "ques_2",
      sessionID: "ses_1",
      questions: [{ header: "Updated", question: "Updated question", options: [] }],
    } as QuestionRequest
    applyDirectoryEvent(draft, {
      type: "question.asked",
      properties: replacement,
    } as Event)

    expect(draft.question.ses_1.map((item) => item.id)).toEqual(["ques_1", "ques_2"])
    expect(draft.question.ses_1[1]).toBe(replacement)

    const afterAsk = draft.question.ses_1
    applyDirectoryEvent(draft, {
      type: "question.replied",
      properties: { sessionID: "ses_1", requestID: "ques_1" },
    } as Event)

    expect(draft.question.ses_1).not.toBe(afterAsk)
    expect(draft.question.ses_1.map((item) => item.id)).toEqual(["ques_2"])

    const afterReply = draft.question.ses_1
    applyDirectoryEvent(draft, {
      type: "question.rejected",
      properties: { sessionID: "ses_1", requestID: "ques_2" },
    } as Event)

    expect(draft.question.ses_1).not.toBe(afterReply)
    expect(draft.question.ses_1).toEqual([])
  })

  test("stamps session_activity when part.updated arrives", () => {
    const draft = state()
    const before = Date.now()

    applyDirectoryEvent(draft, partUpdatedEvent())

    const stamp = draft.session_activity.ses_1
    expect(typeof stamp === "number").toBe(true)
    expect((stamp ?? 0) >= before).toBe(true)
  })

  test("stamps session_activity when part.delta updates an existing part", () => {
    const draft = state({
      part: {
        msg_1: [
          { id: "prt_1", messageID: "msg_1", sessionID: "ses_1", type: "text", text: "" } as Part,
        ],
      },
    })
    const before = Date.now()

    applyDirectoryEvent(draft, deltaEvent())

    const stamp = draft.session_activity.ses_1
    expect(typeof stamp === "number").toBe(true)
    expect((stamp ?? 0) >= before).toBe(true)
  })

  test("clears session_activity on session.idle", () => {
    const draft = state({ session_activity: { ses_1: Date.now() - 1_000 } })

    applyDirectoryEvent(draft, {
      type: "session.idle",
      properties: { sessionID: "ses_1" },
    } as Event)

    expect(draft.session_activity.ses_1 === undefined).toBe(true)
  })

  test("clears session_activity on session.error", () => {
    const draft = state({ session_activity: { ses_1: Date.now() - 1_000 } })

    applyDirectoryEvent(draft, {
      type: "session.error",
      properties: { sessionID: "ses_1" },
    } as Event)

    expect(draft.session_activity.ses_1 === undefined).toBe(true)
  })

  test("clears session_activity when session.status flips to idle", () => {
    const draft = state({
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      session_activity: { ses_1: Date.now() - 1_000 },
    })

    applyDirectoryEvent(draft, {
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "idle" } as SessionStatus },
    } as Event)

    expect(draft.session_activity.ses_1 === undefined).toBe(true)
  })

  test("preserves pending questions when session.status flips to idle", () => {
    const pending = [
      { id: "que_1", sessionID: "ses_1" } as QuestionRequest,
    ]
    const draft = state({
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      question: { ses_1: pending },
    })

    applyDirectoryEvent(draft, {
      type: "session.status",
      properties: { sessionID: "ses_1", status: { type: "idle" } as SessionStatus },
    } as Event)

    expect(draft.question.ses_1).toBe(pending)
  })

  test("preserves pending questions on session.idle", () => {
    const pending = [
      { id: "que_1", sessionID: "ses_1" } as QuestionRequest,
    ]
    const draft = state({ question: { ses_1: pending } })

    applyDirectoryEvent(draft, {
      type: "session.idle",
      properties: { sessionID: "ses_1" },
    } as Event)

    expect(draft.question.ses_1).toBe(pending)
  })

  test("keeps session_activity when session.status stays non-idle", () => {
    const stamp = Date.now() - 1_000
    const draft = state({
      session_status: { ses_1: { type: "busy" } as SessionStatus },
      session_activity: { ses_1: stamp },
    })

    applyDirectoryEvent(draft, {
      type: "session.status",
      properties: {
        sessionID: "ses_1",
        status: { type: "retry", attempt: 1, message: "x", next: 10 } as SessionStatus,
      },
    } as Event)

    expect(draft.session_activity.ses_1).toBe(stamp)
  })
})
