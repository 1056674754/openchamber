import { describe, expect, test } from "bun:test"

import { getBootstrapFailureAction } from "./bootstrap-retry-policy"

describe("getBootstrapFailureAction", () => {
  test("retries transient startup failures within the retry budget", () => {
    expect(getBootstrapFailureAction(4)).toBe("retry")
  })

  test("finishes the store after the retry budget is exhausted", () => {
    expect(getBootstrapFailureAction(5)).toBe("finish")
  })
})
