import { beforeEach, describe, expect, test } from "bun:test"
import {
  beginSyncSessionGeneration,
  resetSyncSessionGenerationsForTests,
} from "./sync-session-generation"

describe("beginSyncSessionGeneration", () => {
  beforeEach(() => {
    resetSyncSessionGenerationsForTests()
  })

  test("keeps the active generation fresh until a newer one starts", () => {
    const isStaleA = beginSyncSessionGeneration("srv\n/dir\nses_a")
    expect(isStaleA()).toBe(false)

    const isStaleB = beginSyncSessionGeneration("srv\n/dir\nses_a")
    expect(isStaleA()).toBe(true)
    expect(isStaleB()).toBe(false)
  })

  test("isolates generations by serverId + directory + sessionID", () => {
    const isStaleLocal = beginSyncSessionGeneration("local\n/a\nses_1")
    const isStaleRemote = beginSyncSessionGeneration("remote\n/a\nses_1")
    const isStaleOtherDir = beginSyncSessionGeneration("local\n/b\nses_1")

    beginSyncSessionGeneration("local\n/a\nses_1")

    expect(isStaleLocal()).toBe(true)
    expect(isStaleRemote()).toBe(false)
    expect(isStaleOtherDir()).toBe(false)
  })
})
