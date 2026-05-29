import { describe, expect, test } from "bun:test"
import { buildRemoteSessionListUrl, REMOTE_SESSION_LIST_LIMIT } from "./session-list-bootstrap"

describe("buildRemoteSessionListUrl", () => {
  test("requests remote session trees instead of root-only sessions", () => {
    const url = new URL(buildRemoteSessionListUrl("/api/remote/ssh-1/", "/repo"), "http://openchamber.test")

    expect(url.pathname).toBe("/api/remote/ssh-1/session")
    expect(url.searchParams.get("directory")).toBe("/repo")
    expect(url.searchParams.get("roots")).toBe("false")
    expect(url.searchParams.get("limit")).toBe(String(REMOTE_SESSION_LIST_LIMIT))
  })
})
