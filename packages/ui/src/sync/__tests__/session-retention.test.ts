import { describe, expect, test } from "bun:test"
import type { Event, Session } from "@opencode-ai/sdk/v2/client"

import { applyDirectoryEvent } from "../event-reducer"
import { INITIAL_STATE, type State } from "../types"

const buildSession = (id: string, updated: number): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory: "/repo",
  title: id,
  version: "test",
  time: { created: updated, updated },
})

describe("session list retention", () => {
  test("evicts the oldest session when id order differs from recency order", () => {
    // Given: a full ID-sorted list whose oldest session is not at either edge.
    const oldest = buildSession("ses_100_oldest", 100)
    const newer = buildSession("ses_200_newer", 200)
    const latest = buildSession("ses_050_latest", 300)
    const draft: State = {
      ...INITIAL_STATE,
      session: [oldest, newer],
      sessionTotal: 2,
      limit: 2,
    }
    const event: Event = {
      id: "evt_session_created",
      type: "session.created",
      properties: { sessionID: latest.id, info: latest },
    }

    // When: the newest session arrives after the store has reached its limit.
    applyDirectoryEvent(draft, event)

    // Then: recency, rather than SDK-specific ID ordering, decides the eviction.
    expect(draft.session.map((session) => session.id)).toEqual(["ses_050_latest", "ses_200_newer"])
  })
})
