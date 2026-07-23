import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import {
  getInitialHistoryRealUserTarget,
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

  test("reissues the initial request at the exact turn boundary", async () => {
    const requests: MessageHistoryRequest[] = []
    const client: MessageHistoryClient = {
      session: {
        messages: async (request) => {
          requests.push(request)
          if (request.limit === 30) {
            return {
              data: [
                { info: message("msg_001", "assistant"), parts: [textPart("prt_001", "msg_001")] },
                { info: message("msg_002", "user"), parts: [textPart("prt_002", "msg_002")] },
                { info: message("msg_003", "assistant"), parts: [textPart("prt_003", "msg_003")] },
              ],
              response: { headers: new Headers({ "x-next-cursor": "cursor-before-msg-001" }) },
            }
          }
          return {
            data: [
              { info: message("msg_002", "user"), parts: [textPart("prt_002", "msg_002")] },
              { info: message("msg_003", "assistant"), parts: [textPart("prt_003", "msg_003")] },
            ],
            response: { headers: new Headers({ "x-next-cursor": "cursor-before-msg-002" }) },
          }
        },
      },
    }

    const result = await loadMessageHistoryBatch({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 30,
      minimumRealUserMessages: 1,
    })

    expect(requests.map((request) => request.limit)).toEqual([30, 2])
    expect(result.page.session.map((item) => item.id)).toEqual(["msg_002", "msg_003"])
    expect(result.page.cursor).toBe("cursor-before-msg-002")
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

  test("shows nested OpenCode error details when a message request returns 502", async () => {
    const client: MessageHistoryClient = {
      session: {
        messages: async () => ({
          error: {
            name: "UnknownError",
            data: {
              message: "Unexpected server error. Check server logs for details.",
              ref: "err_6ca69c3e",
            },
          },
          response: { status: 502 },
        }),
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
    expect(failure.message).toBe(
      "session.messages failed (502): Unexpected server error. Check server logs for details. (err_6ca69c3e)",
    )
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
  test("loads the prompt navigator window on the initial screen", () => {
    expect(getInitialHistoryRealUserTarget(false)).toBe(30)
    expect(getInitialHistoryRealUserTarget(true)).toBe(6)
  })

  test("loads one complete real-user turn per interactive page", () => {
    expect(getInteractiveHistoryRealUserTarget(false)).toBe(1)
    expect(getInteractiveHistoryRealUserTarget(true)).toBe(1)
  })
})
