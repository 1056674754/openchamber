import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import type {
  MessageHistoryClient,
  MessageHistoryRequest,
  MessageHistoryResponse,
} from "../message-history-loader"
import {
  loadCompleteUserPromptHistory,
  loadMessageHistoryThroughTarget,
} from "../prompt-history-loader"

function message(id: string, role: "user" | "assistant"): Message {
  return { id, sessionID: "ses_1", role, time: { created: 1 } } as Message
}

function textPart(id: string, messageID: string, text = id): Part {
  return { id, messageID, sessionID: "ses_1", type: "text", text } as Part
}

function createClient(
  responses: readonly MessageHistoryResponse[],
  requests: MessageHistoryRequest[],
): MessageHistoryClient {
  return {
    session: {
      messages: async (request) => {
        requests.push(request)
        return responses[requests.length - 1] ?? { data: [] }
      },
    },
  }
}

describe("loadCompleteUserPromptHistory", () => {
  test("keeps every real user prompt while scanning every raw cursor page", async () => {
    const requests: MessageHistoryRequest[] = []
    const progress: Array<{ readonly ids: readonly string[]; readonly complete: boolean }> = []
    const client = createClient([
      {
        data: [
          { info: message("msg_005", "user"), parts: [textPart("prt_005", "msg_005", "latest")] },
          { info: message("msg_006", "assistant"), parts: [textPart("prt_006", "msg_006")] },
        ],
        response: { headers: new Headers({ "x-next-cursor": "cursor-1" }) },
      },
      {
        data: [
          { info: message("msg_003", "user"), parts: [textPart("prt_003", "msg_003", "middle")] },
          { info: message("msg_004", "assistant"), parts: [textPart("prt_004", "msg_004")] },
        ],
        response: { headers: new Headers({ "x-next-cursor": "cursor-2" }) },
      },
      {
        data: [
          { info: message("msg_001", "user"), parts: [textPart("prt_001", "msg_001", "oldest")] },
          { info: message("msg_002", "assistant"), parts: [textPart("prt_002", "msg_002")] },
        ],
        response: { headers: new Headers() },
      },
    ], requests)

    const result = await loadCompleteUserPromptHistory({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 100,
      onProgress: (snapshot) => {
        progress.push({
          ids: snapshot.records.map((record) => record.info.id),
          complete: snapshot.complete,
        })
      },
    })

    expect(requests.map((request) => request.before)).toEqual([undefined, "cursor-1", "cursor-2"])
    expect(progress).toEqual([
      { ids: ["msg_005"], complete: false },
      { ids: ["msg_003", "msg_005"], complete: false },
      { ids: ["msg_001", "msg_003", "msg_005"], complete: true },
    ])
    expect(result.records.map((record) => record.info.id)).toEqual(["msg_001", "msg_003", "msg_005"])
    expect(result.complete).toBe(true)
  })
})

describe("loadMessageHistoryThroughTarget", () => {
  test("batches older raw pages until the requested user turn is included", async () => {
    const requests: MessageHistoryRequest[] = []
    const client = createClient([
      {
        data: [
          { info: message("msg_005", "user"), parts: [textPart("prt_005", "msg_005")] },
          { info: message("msg_006", "assistant"), parts: [textPart("prt_006", "msg_006")] },
        ],
        response: { headers: new Headers({ "x-next-cursor": "cursor-2" }) },
      },
      {
        data: [
          { info: message("msg_003", "user"), parts: [textPart("prt_003", "msg_003")] },
          { info: message("msg_004", "assistant"), parts: [textPart("prt_004", "msg_004")] },
        ],
        response: { headers: new Headers({ "x-next-cursor": "cursor-3" }) },
      },
    ], requests)

    const result = await loadMessageHistoryThroughTarget({
      client,
      sessionID: "ses_1",
      directory: "/repo/authoritative",
      limit: 100,
      before: "cursor-1",
      targetMessageID: "msg_003",
    })

    expect(requests.map((request) => request.before)).toEqual(["cursor-1", "cursor-2"])
    expect(result.found).toBe(true)
    expect(result.page.session.map((item) => item.id)).toEqual(["msg_003", "msg_004", "msg_005", "msg_006"])
    expect(result.page.cursor).toBe("cursor-3")
  })
})
