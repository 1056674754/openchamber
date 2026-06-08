import { describe, expect, test } from "bun:test"
import { buildRemoteSessionListUrl, listSessionsForBootstrap, SESSION_LIST_BOOTSTRAP_LIMIT } from "./session-list-bootstrap"

describe("buildRemoteSessionListUrl", () => {
  test("requests remote session trees instead of root-only sessions", () => {
    const url = new URL(buildRemoteSessionListUrl("/api/remote/ssh-1/", "/repo"), "http://openchamber.test")

    expect(url.pathname).toBe("/api/remote/ssh-1/session")
    expect(url.searchParams.get("directory")).toBe("/repo")
    expect(url.searchParams.get("roots")).toBe("false")
    expect(url.searchParams.get("limit")).toBe(String(SESSION_LIST_BOOTSTRAP_LIMIT))
  })

  test("requests local session trees instead of root-only sessions", async () => {
    const calls: unknown[] = []
    const sdk = {
      session: {
        list: async (input: unknown) => {
          calls.push(input)
          return { data: [{ id: "ses_root" }, { id: "ses_child", parentID: "ses_root" }] }
        },
      },
    }

    const sessions = await listSessionsForBootstrap(sdk as never, "default", "/repo")

    expect(sessions.map((session) => session.id)).toEqual(["ses_root", "ses_child"])
    expect(calls).toEqual([
      {
        directory: "/repo",
        roots: false,
        limit: SESSION_LIST_BOOTSTRAP_LIMIT,
      },
    ])
  })
})
