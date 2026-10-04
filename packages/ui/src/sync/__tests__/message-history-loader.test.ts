import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import type { MessagePage } from "@/lib/opencode/client"

import {
  getInitialHistoryRealUserTarget,
  getInteractiveHistoryRealUserTarget,
  loadMessageHistoryBatch,
  MessageHistoryLoadError,
  type MessageHistoryFetchRequest,
  type MessageHistoryFetch,
} from "../message-history-loader"

function message(id: string, role: "user" | "assistant"): Message {
  return { id, sessionID: "ses_1", role, time: { created: 1 } } as Message
}

function textPart(id: string, messageID: string): Part {
  return { id, messageID, sessionID: "ses_1", type: "text", text: id } as Part
}

/** Builds an injected fetch whose pages carry the given records and next cursor. */
function fetchFrom(pages: Array<{ records: Array<{ info: Message; parts: Part[] }>; next?: string }>): {
  fetch: MessageHistoryFetch
  requests: MessageHistoryFetchRequest[]
} {
  const requests: MessageHistoryFetchRequest[] = []
  const fetch: MessageHistoryFetch = async (request) => {
    requests.push(request)
    const page = pages[requests.length - 1] ?? { records: [] }
    return {
      items: page.records,
      cursor: { next: page.next },
    } as MessagePage
  }
  return { fetch, requests }
}

describe("loadMessageHistoryBatch", () => {
  test("follows body cursors until the real user target is reached", async () => {
    const { fetch, requests } = fetchFrom([
      { records: [{ info: message("msg_003", "user"), parts: [textPart("prt_003", "msg_003")] }], next: "cursor-older" },
      { records: [{ info: message("msg_001", "user"), parts: [textPart("prt_001", "msg_001")] }] },
    ])

    const result = await loadMessageHistoryBatch({
      fetch,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
      minimumRealUserMessages: 2,
    })

    expect(requests).toEqual([
      { sessionID: "ses_1", directory: "/repo/authoritative", limit: 150, before: undefined },
      { sessionID: "ses_1", directory: "/repo/authoritative", limit: 150, before: "cursor-older" },
    ])
    expect(result.page.session.map((item) => item.id)).toEqual(["msg_001", "msg_003"])
    expect(result.page.complete).toBe(true)
    expect(result.page.cursor).toBeUndefined()
  })

  test("reissues the initial request at the exact turn boundary", async () => {
    const { fetch, requests } = fetchFrom([
      {
        records: [
          { info: message("msg_001", "assistant"), parts: [textPart("prt_001", "msg_001")] },
          { info: message("msg_002", "user"), parts: [textPart("prt_002", "msg_002")] },
          { info: message("msg_003", "assistant"), parts: [textPart("prt_003", "msg_003")] },
        ],
        next: "cursor-before-msg-002",
      },
      {
        records: [
          { info: message("msg_002", "user"), parts: [textPart("prt_002", "msg_002")] },
          { info: message("msg_003", "assistant"), parts: [textPart("prt_003", "msg_003")] },
        ],
      },
    ])

    const result = await loadMessageHistoryBatch({
      fetch,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 30,
      minimumRealUserMessages: 1,
    })

    expect(requests[0]?.limit).toBe(30)
    expect(result.page.session.map((item) => item.id)).toEqual(["msg_002", "msg_003"])
    expect(result.page.cursor).toBeUndefined()
  })

  test("throws a typed error when the fetch fails", async () => {
    const failure = await loadMessageHistoryBatch({
      fetch: async () => {
        throw Object.assign(new Error("upstream unavailable"), { status: 503 })
      },
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(MessageHistoryLoadError)
    if (!(failure instanceof MessageHistoryLoadError)) throw new Error("expected message history load error")
    expect(failure.status).toBe(503)
  })

  test("carries the raw detail of a gateway failure", async () => {
    const failure = await loadMessageHistoryBatch({
      fetch: async () => {
        throw Object.assign(
          new Error("Unexpected server error. Check server logs for details. (err_6ca69c3e)"),
          { status: 502 },
        )
      },
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(MessageHistoryLoadError)
    if (!(failure instanceof MessageHistoryLoadError)) throw new Error("expected message history load error")
    expect(failure.status).toBe(502)
    expect(failure.message).toBe(
      "session.messages failed (502): Unexpected server error. Check server logs for details. (err_6ca69c3e)",
    )
  })
})

describe("getInteractiveHistoryRealUserTarget", () => {
  test("loads the prompt navigator window on the initial screen", () => {
    expect(getInitialHistoryRealUserTarget(false)).toBe(30)
    expect(getInitialHistoryRealUserTarget(true)).toBe(6)
  })

  test("loads one complete real-user turn per interactive page", () => {
    expect(getInteractiveHistoryRealUserTarget(false)).toBe(1)
    expect(getInteractiveHistoryRealUserTarget(true)).toBe(1)
  })
})
