import { describe, expect, test } from "bun:test"

import { bootstrapDirectory, shouldLogBootstrapFailureAsInfo } from "./bootstrap"
import { formatSdkError, SdkRequestError } from "./sdk-error"
import { INITIAL_STATE } from "./types"

describe("shouldLogBootstrapFailureAsInfo", () => {
  test("treats bootstrap 503 responses as retry noise", () => {
    const error = new Error("session.list failed (503)")
    Object.assign(error, { status: 503 })

    expect(shouldLogBootstrapFailureAsInfo(error)).toBe(true)
  })

  test("keeps remote aborts at error level", () => {
    const error = new Error("session.list failed (499)")
    Object.assign(error, { status: 499 })

    expect(shouldLogBootstrapFailureAsInfo(error)).toBe(false)
  })
})

describe("formatSdkError", () => {
  test("shows nested OpenCode error details instead of object coercion", () => {
    const error = {
      name: "UnknownError",
      data: {
        message: "Unexpected server error. Check server logs for details.",
        ref: "err_6ca69c3e",
      },
    }

    expect(formatSdkError(error)).toBe(
      "Unexpected server error. Check server logs for details. (err_6ca69c3e)",
    )
  })
})

describe("SdkRequestError", () => {
  test("keeps the upstream response and request context for provider failures", () => {
    const upstreamError = {
      name: "BadRequest",
      data: {
        message: "directory is unavailable",
        kind: "Query",
      },
    }

    const error = new SdkRequestError({
      operation: "config.providers",
      endpoint: "/config/providers",
      error: upstreamError,
      response: { status: 400, statusText: "Bad Request" },
      directory: "/tmp/project",
      serverId: "default",
      source: "activateDirectory",
      attempt: 3,
    })

    expect(error.message).toBe(
      "config.providers failed (400 Bad Request): directory is unavailable",
    )
    expect(error.name).toBe("SdkRequestError")
    expect(error.endpoint).toBe("/config/providers")
    expect(error.status).toBe(400)
    expect(error.statusText).toBe("Bad Request")
    expect(error.upstreamMessage).toBe("directory is unavailable")
    expect(error.directory).toBe("/tmp/project")
    expect(error.serverId).toBe("default")
    expect(error.source).toBe("activateDirectory")
    expect(error.attempt).toBe(3)
    expect(error.cause).toBe(upstreamError)
  })
})

describe("bootstrapDirectory", () => {
  test("initializes a directory without touching MCP or command state", async () => {
    const requestedPaths: string[] = []
    const ok = (data: unknown) => Promise.resolve({ data, error: undefined })
    const sdk: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {
      path: { get: () => (requestedPaths.push("path.get"), ok({ directory: "/tmp/project" })) },
      session: { status: () => (requestedPaths.push("session.status"), ok({})) },
      project: { current: () => (requestedPaths.push("project.current"), ok({ id: "proj" })) },
      provider: { list: () => (requestedPaths.push("provider.list"), ok({ all: [], connected: [], default: {} })) },
      config: { get: () => (requestedPaths.push("config.get"), ok({})) },
      app: { agents: () => (requestedPaths.push("app.agents"), ok([])) },
      command: {
        list: () => {
          requestedPaths.push("command.list")
          return ok([])
        },
      },
      mcp: {
        status: () => {
          requestedPaths.push("mcp.status")
          return ok({})
        },
      },
      lsp: { status: () => (requestedPaths.push("lsp.status"), ok([])) },
      vcs: { get: () => (requestedPaths.push("vcs.get"), ok({})) },
      form: { list: () => (requestedPaths.push("question.list"), ok([])) },
      permission: { list: () => (requestedPaths.push("permission.list"), ok([])) },
    }

    let state = { ...INITIAL_STATE }
    const bootstrapped = await bootstrapDirectory({
      directory: "/tmp/project",
      serverId: "default",
      sdk: sdk as never,
      getState: () => state,
      set: (patch) => {
        state = { ...state, ...patch }
      },
      global: {
        config: {},
        projects: [],
        providers: { all: [], connected: [], default: {} },
      },
      loadSessions: () => (requestedPaths.push("session.list"), Promise.resolve([])),
    })

    expect(bootstrapped).toBe(true)
    // Give the fire-and-forget deferred phase a chance to record its requests.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(requestedPaths).not.toContain("mcp.status")
    expect(requestedPaths).not.toContain("command.list")
    expect(state.status).toBe("complete")
  })
})
