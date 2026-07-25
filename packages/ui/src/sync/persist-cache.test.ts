import { beforeEach, describe, expect, test } from "bun:test"
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import {
  clearDirCache,
  persistIcon,
  persistVcs,
  readDirCache,
} from "./persist-cache"

const DIRECTORY = "/Users/me/shared-path"

const createStorage = () => {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => {
      values.clear()
    },
  }
}

beforeEach(() => {
  const storage = createStorage()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  })
})

describe("persist-cache serverId scoping", () => {
  test("keeps local and remote metadata for the same path isolated", () => {
    persistIcon(DIRECTORY, "local-icon", DEFAULT_SERVER_ID)
    persistIcon(DIRECTORY, "remote-icon", "remote-a")

    expect(readDirCache(DIRECTORY, DEFAULT_SERVER_ID).icon).toBe("local-icon")
    expect(readDirCache(DIRECTORY, "remote-a").icon).toBe("remote-icon")

    clearDirCache(DIRECTORY, "remote-a")
    expect(readDirCache(DIRECTORY, DEFAULT_SERVER_ID).icon).toBe("local-icon")
    expect(readDirCache(DIRECTORY, "remote-a").icon).toBeUndefined()
  })

  test("migrates legacy directory keys forward for the default server", () => {
    const legacyPrefixHead = DIRECTORY.slice(0, 12).replace(/[^a-zA-Z0-9]/g, "_")
    let hash = 0
    for (let i = 0; i < DIRECTORY.length; i++) {
      const chr = DIRECTORY.charCodeAt(i)
      hash = ((hash << 5) - hash) + chr
      hash |= 0
    }
    const legacyKey = `oc.dir.${legacyPrefixHead}.${Math.abs(hash).toString(36)}.vcs`
    localStorage.setItem(legacyKey, JSON.stringify({ branch: "main" }))

    const cached = readDirCache(DIRECTORY, DEFAULT_SERVER_ID)
    expect(cached.vcs).toEqual({ branch: "main" })
    expect(localStorage.getItem(legacyKey)).toBeNull()

    // Second read uses the migrated v2 key.
    expect(readDirCache(DIRECTORY, DEFAULT_SERVER_ID).vcs).toEqual({ branch: "main" })
  })

  test("does not clear another server bucket when writing", () => {
    persistVcs(DIRECTORY, { branch: "local" } as never, DEFAULT_SERVER_ID)
    persistVcs(DIRECTORY, { branch: "remote" } as never, "remote-a")
    persistVcs(DIRECTORY, undefined, DEFAULT_SERVER_ID)

    expect(readDirCache(DIRECTORY, DEFAULT_SERVER_ID).vcs).toBeUndefined()
    expect(readDirCache(DIRECTORY, "remote-a").vcs).toEqual({ branch: "remote" })
  })
})
