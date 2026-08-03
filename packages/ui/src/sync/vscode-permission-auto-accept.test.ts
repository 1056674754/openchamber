import { describe, expect, test } from "bun:test"
import { createVSCodePermissionAutoAcceptRuntime } from "./vscode-permission-auto-accept"

const permission = { id: "perm-1", sessionID: "child" }
const session = (id: string, parentID?: string) => ({ id, parentID })

describe("VS Code permission auto-accept runtime", () => {
  test("loads missing child lineage with the event routing target", async () => {
    const fetchedTargets: Array<{ directory?: string; serverId?: string }> = []
    const repliedTargets: Array<{ directory?: string; serverId?: string }> = []
    const runtime = createVSCodePermissionAutoAcceptRuntime({
      getPolicy: () => ({ root: true }),
      getSessions: () => new Map(),
      getSession: async (id, target) => {
        fetchedTargets.push(target)
        return session(id, id === "child" ? "root" : undefined)
      },
      reply: async (_sessionId, _requestId, target) => {
        repliedTargets.push(target)
      },
      wait: async () => undefined,
    })

    const target = { directory: "/repo", serverId: "remote-a" }
    expect(await runtime.processPermission(permission, target)).toBe(true)
    expect(fetchedTargets).toEqual([target])
    expect(repliedTargets).toEqual([target])
  })

  test("honors an explicit child disable over an enabled parent", async () => {
    let replyCalls = 0
    const runtime = createVSCodePermissionAutoAcceptRuntime({
      getPolicy: () => ({ root: true, child: false }),
      getSessions: () => new Map([["child", session("child", "root")]]),
      getSession: async () => session("root"),
      reply: async () => { replyCalls += 1 },
      wait: async () => undefined,
    })

    expect(await runtime.processPermission(permission, {})).toBe(false)
    expect(replyCalls).toBe(0)
  })

  test("fails closed when lineage cannot be loaded", async () => {
    let replyCalls = 0
    const runtime = createVSCodePermissionAutoAcceptRuntime({
      getPolicy: () => ({ root: true }),
      getSessions: () => new Map(),
      getSession: async () => { throw new Error("offline") },
      reply: async () => { replyCalls += 1 },
      wait: async () => undefined,
    })

    expect(await runtime.processPermission(permission, {})).toBe(false)
    expect(replyCalls).toBe(0)
  })

  test("deduplicates concurrent events and retries failed replies", async () => {
    let attempts = 0
    const runtime = createVSCodePermissionAutoAcceptRuntime({
      getPolicy: () => ({ child: true }),
      getSessions: () => new Map(),
      getSession: async () => session("child"),
      reply: async () => {
        attempts += 1
        if (attempts < 2) throw new Error("transient")
      },
      wait: async () => undefined,
    })

    const first = runtime.processPermission(permission, {})
    const second = runtime.processPermission(permission, {})
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(attempts).toBe(2)
  })

  test("keeps identical permission ids isolated by server and directory", async () => {
    const repliedTargets: Array<{ directory?: string; serverId?: string }> = []
    const runtime = createVSCodePermissionAutoAcceptRuntime({
      getPolicy: () => ({ child: true }),
      getSessions: () => new Map(),
      getSession: async () => session("child"),
      reply: async (_sessionId, _requestId, target) => {
        repliedTargets.push(target)
      },
      wait: async () => undefined,
    })

    const local = { directory: "/repo", serverId: "default" }
    const remote = { directory: "/repo", serverId: "remote-a" }
    expect(await runtime.processPermission(permission, local)).toBe(true)
    expect(await runtime.processPermission(permission, remote)).toBe(true)
    expect(repliedTargets).toEqual([local, remote])
  })
})
