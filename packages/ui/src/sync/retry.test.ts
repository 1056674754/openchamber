import { describe, expect, test } from "bun:test"

import { applyBoundedRetryJitter, computeRetryDelayMs, isTransientError } from "./retry"

describe("retry backoff", () => {
  test("treats 429 and 408 as transient without retrying permanent 4xx", () => {
    expect(isTransientError({ status: 429 })).toBe(true)
    expect(isTransientError({ status: 408 })).toBe(true)
    expect(isTransientError({ status: 401 })).toBe(false)
  })

  test("uses Retry-After as a minimum and adds deterministic positive jitter", () => {
    const delay = computeRetryDelayMs({ retryAfterMs: 2_000 }, 0, {
      delay: 500,
      factor: 2,
      maxDelay: 10_000,
      jitter: 0.25,
      random: () => 0.5,
    })

    expect(delay).toBe(2_250)
  })

  test("keeps reconnect jitter within the configured cap", () => {
    expect(applyBoundedRetryJitter(1_000, 5_000, () => 0)).toBe(800)
    expect(applyBoundedRetryJitter(1_000, 5_000, () => 1)).toBe(1_200)
    expect(applyBoundedRetryJitter(5_000, 5_000, () => 1)).toBe(5_000)
  })
})
