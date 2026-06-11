import { describe, expect, test } from "bun:test"

import { shouldLogBootstrapFailureAsInfo } from "./bootstrap"

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
