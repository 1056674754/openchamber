import { describe, expect, test } from "bun:test"
import { KeyedSingleFlight } from "../keyed-single-flight"

describe("KeyedSingleFlight", () => {
  test("joins concurrent work for the same key across callers", async () => {
    const singleFlight = new KeyedSingleFlight<string, number>()
    let calls = 0
    let release: ((value: number) => void) | undefined

    const operation = () => {
      calls += 1
      return new Promise<number>((resolve) => {
        release = resolve
      })
    }

    const first = singleFlight.run("session", operation)
    const second = singleFlight.run("session", operation)

    expect(calls).toBe(1)
    release?.(42)
    expect(await first).toBe(42)
    expect(await second).toBe(42)
    expect(singleFlight.has("session")).toBe(false)
  })

  test("does not deduplicate different keys", async () => {
    const singleFlight = new KeyedSingleFlight<string, string>()
    let calls = 0

    const [first, second] = await Promise.all([
      singleFlight.run("a", async () => {
        calls += 1
        return "a"
      }),
      singleFlight.run("b", async () => {
        calls += 1
        return "b"
      }),
    ])

    expect([first, second]).toEqual(["a", "b"])
    expect(calls).toBe(2)
  })
})
