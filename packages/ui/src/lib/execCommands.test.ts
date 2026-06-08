import { beforeEach, describe, expect, mock, test } from "bun:test"

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    setDirectory: () => {},
    getDirectory: () => "/local/project",
    getSdkClient: () => ({}),
    getScopedSdkClient: () => ({}),
  },
}))

const { serverRegistry } = await import("@/lib/opencode/server-registry")
const { useProjectsStore } = await import("@/stores/useProjectsStore")
const { execCommands } = await import("./execCommands")

const originalWindow = globalThis.window
const originalFetch = globalThis.fetch

const installRuntimeExec = (calls: Array<{ commands: string[]; cwd: string }>) => {
  ;(globalThis as unknown as { window: unknown }).window = {
    __OPENCHAMBER_RUNTIME_APIS__: {
      files: {
        execCommands: async (commands: string[], cwd: string) => {
          calls.push({ commands, cwd })
          return {
            success: true,
            results: [{ command: commands[0] ?? "", success: true }],
          }
        },
      },
    },
  }
}

const restoreWindow = () => {
  ;(globalThis as unknown as { window: unknown }).window = originalWindow
}

beforeEach(() => {
  restoreWindow()
  globalThis.fetch = originalFetch
  useProjectsStore.setState({ projects: [], activeProjectId: null })
  serverRegistry.forgetSession("remote-session")
  serverRegistry.unregister("remote-a")
})

describe("execCommands", () => {
  test("uses the runtime files API for local command execution", async () => {
    const runtimeCalls: Array<{ commands: string[]; cwd: string }> = []
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    installRuntimeExec(runtimeCalls)
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init })
      return new Response(JSON.stringify({ success: true, results: [] }), {
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const result = await execCommands(["pwd"], "/local/project")

    expect(result.success).toBe(true)
    expect(runtimeCalls).toEqual([{ commands: ["pwd"], cwd: "/local/project" }])
    expect(fetchCalls).toHaveLength(0)
  })

  test("routes remote command execution through the remote HTTP base", async () => {
    useProjectsStore.setState({
      projects: [{
        id: "remote-project",
        path: "/remote/project",
        label: "Remote Project",
        serverId: "remote-a",
      }],
      activeProjectId: "remote-project",
    })
    serverRegistry.register({
      id: "remote-a",
      label: "Remote Project",
      baseUrl: "/api/remote/remote-a",
    })
    serverRegistry.setHealthStatus("remote-a", "healthy")
    const runtimeCalls: Array<{ commands: string[]; cwd: string }> = []
    const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    installRuntimeExec(runtimeCalls)
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init })
      return new Response(JSON.stringify({ success: true, results: [] }), {
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    const result = await execCommands(["pwd"], "/remote/project")

    expect(result.success).toBe(true)
    expect(runtimeCalls).toHaveLength(0)
    expect(fetchCalls).toHaveLength(1)
    expect(String(fetchCalls[0]?.input)).toBe("/api/remote/remote-a/fs/exec")
    expect(fetchCalls[0]?.init?.method).toBe("POST")
    expect(JSON.parse(String(fetchCalls[0]?.init?.body))).toEqual({
      commands: ["pwd"],
      cwd: "/remote/project",
      background: false,
    })
  })
})
