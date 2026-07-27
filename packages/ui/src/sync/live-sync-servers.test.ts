import { describe, expect, test } from "bun:test"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { resolveLiveSyncServers } from "./live-sync-servers"

function clearNonDefaultServers(): void {
  for (const connection of serverRegistry.getAll()) {
    if (connection.config.id !== DEFAULT_SERVER_ID) {
      serverRegistry.unregister(connection.config.id)
    }
  }
}

describe("resolveLiveSyncServers", () => {
  test("returns empty when active server is default", () => {
    clearNonDefaultServers()
    expect(resolveLiveSyncServers(DEFAULT_SERVER_ID)).toEqual([])
    expect(resolveLiveSyncServers(null)).toEqual([])
  })

  test("returns empty when remote is listed healthy in store sense but not registered for live sync", () => {
    clearNonDefaultServers()
    expect(resolveLiveSyncServers("remote-a")).toEqual([])
  })

  test("returns only the active healthy remote — not every registered remote", () => {
    clearNonDefaultServers()
    serverRegistry.register({
      id: "remote-a",
      label: "A",
      baseUrl: "/api/remote/remote-a",
    })
    serverRegistry.setHealthStatus("remote-a", "healthy")
    serverRegistry.register({
      id: "remote-b",
      label: "B",
      baseUrl: "/api/remote/remote-b",
    })
    serverRegistry.setHealthStatus("remote-b", "healthy")

    const live = resolveLiveSyncServers("remote-a")
    expect(live.map((entry) => entry.id)).toEqual(["remote-a"])
    clearNonDefaultServers()
  })

  test("skips active remote that is not healthy", () => {
    clearNonDefaultServers()
    serverRegistry.register({
      id: "remote-a",
      label: "A",
      baseUrl: "/api/remote/remote-a",
    })
    serverRegistry.setHealthStatus("remote-a", "connecting")
    expect(resolveLiveSyncServers("remote-a")).toEqual([])
    clearNonDefaultServers()
  })

  test("skips legacy mobile-active synthetic id", () => {
    clearNonDefaultServers()
    expect(resolveLiveSyncServers("mobile-active")).toEqual([])
  })
})
