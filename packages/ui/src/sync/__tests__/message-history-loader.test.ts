import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import {
  getInteractiveHistoryRealUserTarget,
  loadMessageHistoryBatch,
  MessageHistoryLoadError,
  type MessageHistoryClient,
  type MessageHistoryRequest,
  type MessageHistoryResponse,
} from "../message-history-loader"

function message(id: string, role: "user" | "assistant"): Message {
  return { id, sessionID: "ses_1", role, time: { created: 1 } } as Message
}

function textPart(id: string, messageID: string): Part {
  return { id, messageID, sessionID: "ses_1", type: "text", text: id } as Part
}

describe("loadMessageHistoryBatch", () => {
  test("uses the authoritative directory and follows cursors until the real user target is reached", async () => {
    const requests: MessageHistoryRequest[] = []
    const responses: MessageHistoryResponse[] = [
      {
        data: [{ info: message("msg_003", "user"), parts: [textPart("prt_003", "msg_003")] }],
        response: { headers: new Headers({ "content-length": "100", "x-next-cursor": "cursor-older" }) },
      },
      {
        data: [{ info: message("msg_001", "user"), parts: [textPart("prt_001", "msg_001")] }],
        response: { headers: new Headers({ "content-length": "200" }) },
      },
    ]
    const client: MessageHistoryClient = {
      session: {
        messages: async (request) => {
          requests.push(request)
          return responses[requests.length - 1] ?? { data: [] }
        },
      },
    }

    const result = await loadMessageHistoryBatch({
      client,
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
    expect(result.page.payloadBytes).toBe(300)
  })

  test("throws a typed error when the authoritative fetch fails", async () => {
    const client: MessageHistoryClient = {
      session: {
        messages: async () => ({ error: { message: "upstream unavailable" }, response: { status: 503 } }),
      },
    }

    const failure = await loadMessageHistoryBatch({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
    }).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(MessageHistoryLoadError)
    if (!(failure instanceof MessageHistoryLoadError)) throw new Error("expected message history load error")
    expect(failure.status).toBe(503)
  })

  test("does not treat compressed content length as the decoded payload budget", async () => {
    const client: MessageHistoryClient = {
      session: {
        messages: async () => ({
          data: [{ info: message("msg_001", "user"), parts: [textPart("prt_001", "msg_001")] }],
          response: {
            headers: new Headers({
              "content-encoding": "gzip",
              "content-length": "100",
            }),
          },
        }),
      },
    }

    const result = await loadMessageHistoryBatch({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
    })

    expect(result.page.payloadBytes).toBe(undefined)
  })

  test("uses the proxy decoded-payload length even when the browser response is compressed", async () => {
    const client: MessageHistoryClient = {
      session: {
        messages: async () => ({
          data: [{ info: message("msg_001", "user"), parts: [textPart("prt_001", "msg_001")] }],
          response: {
            headers: new Headers({
              "content-encoding": "gzip",
              "content-length": "100",
              "x-openchamber-decoded-content-length": "2400",
            }),
          },
        }),
      },
    }

    const result = await loadMessageHistoryBatch({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 150,
    })

    expect(result.page.payloadBytes).toBe(2400)
  })
})

describe("getInteractiveHistoryRealUserTarget", () => {
  test("uses a larger turn batch for web and desktop than for VS Code", () => {
    expect(getInteractiveHistoryRealUserTarget(false)).toBe(30)
    expect(getInteractiveHistoryRealUserTarget(true)).toBe(6)
  })
})
