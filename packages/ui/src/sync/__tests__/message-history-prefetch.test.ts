import { describe, expect, test } from "bun:test"

import { createSinglePageHistoryPrefetch } from "../message-history-prefetch"

describe("single-page message history prefetch", () => {
  test("reuses one background request for the same history cursor", async () => {
    const prefetch = createSinglePageHistoryPrefetch<number>()
    let requests = 0

    const first = prefetch.prepare("/repo\nses_1\ncursor_1", async () => {
      requests += 1
      return 42
    })
    const second = prefetch.prepare("/repo\nses_1\ncursor_1", async () => {
      requests += 1
      return 99
    })

    expect(first).toBe(second)
    expect(await second).toBe(42)
    expect(requests).toBe(1)
  })

  test("hands the prepared page to the matching cursor only once", async () => {
    const prefetch = createSinglePageHistoryPrefetch<number>()
    const prepared = prefetch.prepare("/repo\nses_1\ncursor_1", async () => 42)

    expect(prefetch.take("/repo\nses_1\ncursor_other")).toBe(undefined)
    expect(prefetch.take("/repo\nses_1\ncursor_1")).toBe(prepared)
    expect(prefetch.take("/repo\nses_1\ncursor_1")).toBe(undefined)
  })

  test("replaces a stale session cursor without retaining its page", async () => {
    const prefetch = createSinglePageHistoryPrefetch<number>()
    prefetch.prepare("/repo\nses_1\ncursor_1", async () => 1)
    const current = prefetch.prepare("/repo\nses_2\ncursor_2", async () => 2)

    expect(prefetch.take("/repo\nses_1\ncursor_1")).toBe(undefined)
    expect(prefetch.take("/repo\nses_2\ncursor_2")).toBe(current)
    expect(await current).toBe(2)
  })
})
