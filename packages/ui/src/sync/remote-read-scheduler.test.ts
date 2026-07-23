import { describe, expect, test } from "bun:test"

import { KeyedRemoteReadCache, RemoteReadScheduler } from "./remote-read-scheduler"

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe("RemoteReadScheduler", () => {
  test("caps reads per server while allowing another server to progress", async () => {
    const scheduler = new RemoteReadScheduler(3)
    const releases = Array.from({ length: 5 }, () => deferred<void>())
    let activeA = 0
    let maxActiveA = 0
    let startedA = 0
    let startedB = 0

    const requestsA = releases.map((release) => scheduler.schedule("remote-a", async () => {
      startedA += 1
      activeA += 1
      maxActiveA = Math.max(maxActiveA, activeA)
      await release.promise
      activeA -= 1
      return startedA
    }))
    const requestB = scheduler.schedule("remote-b", async () => {
      startedB += 1
      return "ready"
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(startedA).toBe(3)
    expect(maxActiveA).toBe(3)
    expect(await requestB).toBe("ready")
    expect(startedB).toBe(1)

    for (const release of releases) release.resolve()
    await Promise.all(requestsA)
    expect(startedA).toBe(5)
    expect(maxActiveA).toBe(3)
  })

  test("admits an interactive read before queued background discovery", async () => {
    const scheduler = new RemoteReadScheduler(1)
    const firstRelease = deferred<void>()
    const order: string[] = []
    const first = scheduler.schedule("remote-a", async () => {
      order.push("background-1")
      await firstRelease.promise
    }, { priority: "background" })
    const second = scheduler.schedule("remote-a", async () => {
      order.push("background-2")
    }, { priority: "background" })
    const interactive = scheduler.schedule("remote-a", async () => {
      order.push("interactive")
    })

    firstRelease.resolve()
    await Promise.all([first, second, interactive])

    expect(order).toEqual(["background-1", "interactive", "background-2"])
  })
})

describe("KeyedRemoteReadCache", () => {
  test("coalesces the same server and resource key", async () => {
    const scheduler = new RemoteReadScheduler(3)
    const cache = new KeyedRemoteReadCache<number>(scheduler)
    const release = deferred<number>()
    let calls = 0
    const run = () => cache.schedule("remote-a", "session:/repo", async () => {
      calls += 1
      return release.promise
    })

    const first = run()
    const second = run()
    release.resolve(42)

    expect(await first).toBe(42)
    expect(await second).toBe(42)
    expect(calls).toBe(1)
  })

  test("does not collide when two servers expose the same path", async () => {
    const scheduler = new RemoteReadScheduler(3)
    const cache = new KeyedRemoteReadCache<string>(scheduler)
    let calls = 0

    const values = await Promise.all([
      cache.schedule("remote-a", "session:/repo", async () => {
        calls += 1
        return "a"
      }),
      cache.schedule("remote-b", "session:/repo", async () => {
        calls += 1
        return "b"
      }),
    ])

    expect(values).toEqual(["a", "b"])
    expect(calls).toBe(2)
  })
})
