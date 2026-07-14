import { describe, expect, test } from "bun:test"

import { shouldLogBootstrapFailureAsInfo } from "./bootstrap"
import { formatSdkError, SdkRequestError } from "./sdk-error"

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
