import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"

import { createRemoteSessionSummarySync } from "./remote-session-summaries"

const makeSession = (id: string, directory: string): Session => ({
  id,
  slug: id,
  projectID: "project",
  directory,
  title: id,
  version: "v1",
  time: { created: 1, updated: 1 },
})

describe("createRemoteSessionSummarySync", () => {
  test("does not rescan or materialize 42 unchanged remote directories", async () => {
    const directories = Array.from({ length: 42 }, (_, index) => `/remote/repo-${index}`)
    let requests = 0
    let applied = 0
    const sync = createRemoteSessionSummarySync({
      ttlMs: 30_000,
      now: () => 1_000,
      loadDirectory: async (_serverId, directory) => {
        requests += 1
        return [makeSession(`session-${directory}`, directory)]
      },
    })

    await sync.scan({
      serverId: "remote-a",
      directories,
      onSnapshot: () => { applied += 1 },
    })
    await sync.scan({
      serverId: "remote-a",
      directories: [...directories].reverse(),
      onSnapshot: () => { applied += 1 },
    })

    expect(requests).toBe(42)
    expect(applied).toBe(42)
  })

  test("does not cache a failed directory as an empty success", async () => {
    let requests = 0
    const sync = createRemoteSessionSummarySync({
      ttlMs: 30_000,
      now: () => 1_000,
      loadDirectory: async () => {
        requests += 1
        if (requests === 1) throw new Error("temporary failure")
        return []
      },
    })

    const first = await sync.scan({
      serverId: "remote-a",
      directories: ["/remote/repo"],
      onSnapshot: () => { throw new Error("failed reads must not apply an empty snapshot") },
    })
    let applied = 0
    const second = await sync.scan({
      serverId: "remote-a",
      directories: ["/remote/repo"],
      onSnapshot: () => { applied += 1 },
    })

    expect(first.failedDirectories).toEqual(["/remote/repo"])
    expect(second.failedDirectories).toEqual([])
    expect(requests).toBe(2)
    expect(applied).toBe(1)
  })
})
