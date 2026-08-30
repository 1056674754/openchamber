import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { fetchMessagePageToUserBoundary, type MessagePage } from "./message-page-boundary"
import { retry } from "./retry"
import { sanitizePartPayload, stripMessageDiffSnapshots } from "./sanitize"
import { formatSdkError } from "./sdk-error"
import { sortMessagesChronologically } from './message-ordering'

const DECODED_PAYLOAD_LENGTH_HEADER = "x-openchamber-decoded-content-length"

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

export type MessageHistoryPageInput = Omit<MessageHistoryBatchInput, "minimumRealUserMessages">

export class MessageHistoryLoadError extends Error {
  readonly name = "MessageHistoryLoadError"

  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export function getInitialHistoryRealUserTarget(isVSCode: boolean): number {
  return isVSCode ? 6 : 30
}

export function getInteractiveHistoryRealUserTarget(isVSCode: boolean): number {
  void isVSCode
  return 1
}

function unwrapMessageRecords(result: MessageHistoryResponse): readonly MessageHistoryRecord[] {
  if (result.error !== undefined) {
    const status = result.response?.status
    const suffix = status === undefined ? "" : ` (${status})`
    throw new MessageHistoryLoadError(`session.messages failed${suffix}: ${formatSdkError(result.error)}`, status)
  }
  if (result.data === undefined) {
    throw new MessageHistoryLoadError("session.messages returned no data", 503)
  }
  const data = result.data as unknown
  if (Array.isArray(data)) {
    return data as readonly MessageHistoryRecord[]
  }
  // Defensive: some proxies / Capacitor rewrite paths wrap the page as an object.
  if (data && typeof data === "object") {
    const nested = (data as { data?: unknown; messages?: unknown; items?: unknown }).data
      ?? (data as { messages?: unknown }).messages
      ?? (data as { items?: unknown }).items
    if (Array.isArray(nested)) {
      return nested as readonly MessageHistoryRecord[]
    }
  }
  const kind = Array.isArray(data) ? "array" : typeof data
  const hint = typeof data === "string"
    ? (data.trimStart().startsWith("<") ? " (html)" : " (string)")
    : data && typeof data === "object"
      ? ` (keys: ${Object.keys(data as object).slice(0, 6).join(",") || "none"})`
      : ""
  throw new MessageHistoryLoadError(`session.messages returned non-array data: ${kind}${hint}`, 503)
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

export async function fetchMessageHistoryPage(input: MessageHistoryPageInput): Promise<MessagePage> {
  const request: MessageHistoryRequest = {
    sessionID: input.sessionID,
    directory: input.directory,
    limit: input.limit,
    before: input.before,
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
    session: sortMessagesChronologically(records.map((record) => stripMessageDiffSnapshots(record.info))),
    part: records.map((record) => ({
      id: record.info.id,
      part: (record.parts ?? []).map(sanitizePartPayload),
    })),
    cursor,
    complete: !cursor,
    payloadBytes: readPayloadBytes(result),
  }
}

export async function loadMessageHistoryBatch(input: MessageHistoryBatchInput): Promise<MessageHistoryBatchResult> {
  const fetchPage = (before: string | undefined, limit: number): Promise<MessagePage> => fetchMessageHistoryPage({
    client: input.client,
    sessionID: input.sessionID,
    directory: input.directory,
    limit,
    before,
    requestTimeout: input.requestTimeout,
  })

  return fetchMessagePageToUserBoundary({
    page: await fetchPage(input.before, input.limit),
    fetchOlder: (cursor) => fetchPage(cursor, input.limit),
    refetchFromStart: (limit) => fetchPage(input.before, limit),
    minimumRealUserMessages: input.minimumRealUserMessages,
  })
}
