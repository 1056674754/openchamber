import { describe, expect, test } from "bun:test"

import { shouldLogBootstrapFailureAsInfo } from "./bootstrap"
import { formatSdkError } from "./sdk-error"

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
