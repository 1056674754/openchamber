import { describe, expect, test } from "bun:test"
import { buildRemoteSessionListUrl, listSessionsForBootstrap, SESSION_LIST_BOOTSTRAP_LIMIT, unwrapSessionListRows } from "./session-list-bootstrap"

describe("buildRemoteSessionListUrl", () => {
  test("requests remote session trees instead of root-only sessions", () => {
    const url = new URL(buildRemoteSessionListUrl("/api/remote/ssh-1/", "/repo"), "http://openchamber.test")

    expect(url.pathname).toBe("/api/remote/ssh-1/session")
    expect(url.searchParams.get("directory")).toBe("/repo")
    expect(url.searchParams.get("roots")).toBe("false")
    expect(url.searchParams.get("limit")).toBe(String(SESSION_LIST_BOOTSTRAP_LIMIT))
  })

  test("can request root-only remote sessions", () => {
    const url = new URL(
      buildRemoteSessionListUrl("/api/remote/ssh-1/", "/repo", { roots: true }),
      "http://openchamber.test",
    )
    expect(url.searchParams.get("roots")).toBe("true")
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

describe("unwrapSessionListRows", () => {
  test("passes the v1 bare array through", () => {
    expect(unwrapSessionListRows([{ id: "a" }, { id: "b" }])).toEqual([{ id: "a" }, { id: "b" }])
  })

  test("unwraps the v2 cursor-pagination envelope", () => {
    expect(unwrapSessionListRows({ data: [{ id: "a" }], cursor: 3 })).toEqual([{ id: "a" }])
  })

  test("non-array non-envelope data yields no rows", () => {
    expect(unwrapSessionListRows({ location: { directory: "/repo" } })).toEqual([])
    expect(unwrapSessionListRows(undefined)).toEqual([])
  })
})
