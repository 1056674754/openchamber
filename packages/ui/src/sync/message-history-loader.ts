import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { fetchMessagePageToUserBoundary, type MessagePage } from "./message-page-boundary"
import { retry } from "./retry"
import { sanitizePartPayload, stripMessageDiffSnapshots } from "./sanitize"

const DECODED_PAYLOAD_LENGTH_HEADER = "x-openchamber-decoded-content-length"
const compareIDs = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

export type MessageHistoryRecord = {
  readonly info: Message
  readonly parts?: readonly Part[]
}

export type MessageHistoryRequest = {
  readonly sessionID: string
  readonly directory: string
  readonly limit: number
  readonly before?: string
}

export type MessageHistoryResponse = {
  readonly data?: readonly MessageHistoryRecord[]
  readonly error?: unknown
  readonly response?: {
    readonly status?: number
    readonly headers?: {
      get(name: string): string | null
    }
  }
}

export type MessageHistoryClient = {
  readonly session: {
    messages(input: MessageHistoryRequest): Promise<MessageHistoryResponse>
  }
}

export type MessageHistoryBatchInput = {
  readonly client: MessageHistoryClient
  readonly sessionID: string
  readonly directory: string
  readonly limit: number
  readonly before?: string
  readonly minimumRealUserMessages?: number
  readonly requestTimeout?: (
    request: Promise<MessageHistoryResponse>,
    label: string,
  ) => Promise<MessageHistoryResponse>
}

export type MessageHistoryBatchResult = {
  readonly page: MessagePage
  readonly extraPages: number
  readonly stoppedBeforeBoundary: boolean
}

export class MessageHistoryLoadError extends Error {
  readonly name = "MessageHistoryLoadError"

  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export function getInteractiveHistoryRealUserTarget(isVSCode: boolean): number {
  return isVSCode ? 6 : 30
}

function errorMessage(error: unknown): string {
  if (typeof error !== "object" || error === null || !("message" in error)) {
    return String(error)
  }
  return String(error.message)
}

function unwrapMessageRecords(result: MessageHistoryResponse): readonly MessageHistoryRecord[] {
  if (result.error !== undefined) {
    const status = result.response?.status
    const suffix = status === undefined ? "" : ` (${status})`
    throw new MessageHistoryLoadError(`session.messages failed${suffix}: ${errorMessage(result.error)}`, status)
  }
  if (result.data === undefined) {
    throw new MessageHistoryLoadError("session.messages returned no data", 503)
  }
  return result.data
}

function readPayloadBytes(result: MessageHistoryResponse): number | undefined {
  const decodedLength = result.response?.headers?.get(DECODED_PAYLOAD_LENGTH_HEADER)
  if (decodedLength) {
    const value = Number(decodedLength)
    if (Number.isSafeInteger(value) && value >= 0) return value
  }
  const contentEncoding = result.response?.headers?.get("content-encoding")?.trim().toLowerCase()
  if (contentEncoding && contentEncoding !== "identity") return undefined
  const raw = result.response?.headers?.get("content-length")
  if (!raw) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export async function loadMessageHistoryBatch(input: MessageHistoryBatchInput): Promise<MessageHistoryBatchResult> {
  const fetchPage = async (before?: string): Promise<MessagePage> => {
    const request: MessageHistoryRequest = {
      sessionID: input.sessionID,
      directory: input.directory,
      limit: input.limit,
      before,
    }
    const result = await retry(() => {
      const pending = input.client.session.messages(request)
      return input.requestTimeout
        ? input.requestTimeout(pending, `session.messages ${input.sessionID}`)
        : pending
    })
    const records = unwrapMessageRecords(result).filter((record) => Boolean(record.info?.id))
    const cursor = result.response?.headers?.get("x-next-cursor") || undefined

    return {
      session: records
        .map((record) => stripMessageDiffSnapshots(record.info))
        .sort((left, right) => compareIDs(left.id, right.id)),
      part: records.map((record) => ({
        id: record.info.id,
        part: (record.parts ?? [])
          .map(sanitizePartPayload)
          .sort((left, right) => compareIDs(left.id, right.id)),
      })),
      cursor,
      complete: !cursor,
      payloadBytes: readPayloadBytes(result),
    }
  }

  return fetchMessagePageToUserBoundary({
    page: await fetchPage(input.before),
    fetchOlder: fetchPage,
    minimumRealUserMessages: input.minimumRealUserMessages,
  })
}
