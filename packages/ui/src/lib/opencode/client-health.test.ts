import { describe, expect, test } from "bun:test"
import { buildOpenCodeHealthUrl } from "./health-url"

describe("buildOpenCodeHealthUrl", () => {
  test("uses the server opencode health route for relative api base", () => {
    expect(buildOpenCodeHealthUrl("/api")).toBe("/api/opencode/health")
  })

  test("keeps desktop absolute api base under /api", () => {
    expect(buildOpenCodeHealthUrl("http://127.0.0.1:4096/api")).toBe("http://127.0.0.1:4096/api/opencode/health")
  })

  test("keeps remote instance api base under the remote route", () => {
    expect(buildOpenCodeHealthUrl("/api/remote/remote-a")).toBe("/api/remote/remote-a/opencode/health")
  })
})
