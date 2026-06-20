import { beforeEach, describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"

import {
  getMissingSteerSideChannelRecords,
  getSteerSideChannelSignature,
  persistSteerSideChannelMessage,
} from "./steer-side-channel"

const createStorage = () => {
  const values = new Map<string, string>()
  return {
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

const installStorage = () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: createStorage(),
    },
  })
}

beforeEach(() => {
  installStorage()
})

describe("steer side channel", () => {
  test("replays a persisted steer message when the server snapshot omits it", () => {
    persistSteerSideChannelMessage({
      sessionID: "ses_1",
      messageID: "msg_2",
      parentID: "msg_1",
      text: "keep this visible",
      createdAt: 10,
      providerID: "anthropic",
      modelID: "claude",
      agent: "default",
    })

    const records = getMissingSteerSideChannelRecords("ses_1", [
      { id: "msg_1", role: "assistant", sessionID: "ses_1" } as Message,
    ])

    expect(records).toHaveLength(1)
    expect(records[0]?.info.id).toBe("msg_2")
    expect((records[0]?.info as unknown as { parentID?: string }).parentID).toBe("msg_1")
    expect((records[0]?.info as unknown as { metadata?: Record<string, unknown> }).metadata?.openchamberLiveSteer).toBe(true)
    expect(records[0]?.parts[0]?.type).toBe("text")
    expect((records[0]?.parts[0] as { text?: string } | undefined)?.text).toBe("keep this visible")
    expect(getSteerSideChannelSignature("ses_1")).toContain("msg_2:msg_1")
  })

  test("does not replay steer messages already present in the server snapshot", () => {
    persistSteerSideChannelMessage({
      sessionID: "ses_1",
      messageID: "msg_2",
      parentID: "msg_1",
      text: "already present",
      createdAt: 10,
      providerID: "anthropic",
      modelID: "claude",
      agent: "default",
    })

    expect(getMissingSteerSideChannelRecords("ses_1", [
      { id: "msg_2", role: "user", sessionID: "ses_1" } as Message,
    ])).toEqual([])
  })
})
