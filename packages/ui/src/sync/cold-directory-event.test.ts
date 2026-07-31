import { describe, expect, test } from "bun:test"
import type { Event, Session } from "@opencode-ai/sdk/v2/client"

import { classifyColdDirectoryEvent } from "./cold-directory-event"

const session: Session = {
  id: "ses_1",
  slug: "session",
  projectID: "project",
  directory: "/repo",
  title: "Session",
  version: "test",
  time: { created: 1, updated: 1 },
}

describe("classifyColdDirectoryEvent", () => {
  test("projects session summaries without materializing the directory", () => {
    const event: Event = {
      id: "evt_1",
      type: "session.updated",
      properties: { sessionID: session.id, info: session },
    }

    expect(classifyColdDirectoryEvent(event)).toEqual({ kind: "session", info: session })
  })

  test("projects live status without materializing the directory", () => {
    const event: Event = {
      id: "evt_2",
      type: "session.status",
      properties: { sessionID: session.id, status: { type: "busy" } },
    }

    expect(classifyColdDirectoryEvent(event)).toEqual({
      kind: "status",
      sessionID: session.id,
      status: { type: "busy" },
    })
  })

  test("materializes a directory for a blocking request", () => {
    const event: Event = {
      id: "evt_3",
      type: "permission.asked",
      properties: {
        id: "perm_1",
        sessionID: session.id,
        permission: "bash",
        patterns: [],
        metadata: {},
        always: [],
      },
    }

    expect(classifyColdDirectoryEvent(event)).toEqual({ kind: "materialize" })
  })

  test("ignores streaming payloads for an unopened directory", () => {
    const event: Event = {
      id: "evt_4",
      type: "message.part.delta",
      properties: {
        sessionID: session.id,
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "x",
      },
    }

    expect(classifyColdDirectoryEvent(event)).toEqual({ kind: "ignore" })
  })
})
