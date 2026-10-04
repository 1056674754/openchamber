import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { opencodeClient, type MessagePage as ClientMessagePage } from "@/lib/opencode/client"
import { fetchMessagePageToUserBoundary, type MessagePage } from "./message-page-boundary"
import { retry } from "./retry"
import { sanitizePartPayload, stripMessageDiffSnapshots } from "./sanitize"
import { sortMessagesChronologically } from './message-ordering'

export type MessageHistoryRecord = {
  readonly info: Message
  readonly parts?: readonly Part[]
}

export type MessageHistoryFetchRequest = {
  readonly sessionID: string
  readonly directory: string
  readonly limit: number
  /** Older-than cursor. The v2 wire reads it from the page body, not a header. */
  readonly before?: string
}

/**
 * Injectable page fetch (tests); the default rides the unified v2 client,
 * whose `getSessionMessages` already projects the wire into the fork's
 * `{ info, parts }` records and drops the last page's `next` cursor.
 */
export type MessageHistoryFetch = (request: MessageHistoryFetchRequest) => Promise<ClientMessagePage>

export const fetchSessionMessagePage: MessageHistoryFetch = (request) =>
  opencodeClient.getSessionMessages(
    request.sessionID,
    { limit: request.limit, cursor: request.before },
    request.directory,
  )

export type MessageHistoryBatchInput = {
  readonly sessionID: string
  readonly directory: string
  /** Owning server lane; omitted (or default) reads the local host. */
  readonly serverId?: string | null
  readonly limit: number
  readonly before?: string
  readonly minimumRealUserMessages?: number
  readonly requestTimeout?: <T>(
    request: Promise<T>,
    label: string,
  ) => Promise<T>
  readonly fetch?: MessageHistoryFetch
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

/**
 * Converts a projected client page into the sync boundary's page shape. The
 * stores still type records with the legacy wire Message/Part (R2 残留:
 * sync-bridge batch retypes them), hence the boundary casts.
 */
function toBoundaryPage(page: ClientMessagePage): MessagePage {
  const records = page.items.filter((record) => Boolean(record.info?.id))
  const cursor = page.cursor.next
  return {
    session: sortMessagesChronologically(
      records.map((record) => stripMessageDiffSnapshots(record.info as unknown as Message)),
    ),
    part: records.map((record) => ({
      id: record.info.id,
      // SAFETY: the projected part is the same JSON envelope the legacy wire
      // carried; only the type-level naming differs across the migration.
      part: (record.parts ?? []).map((part) => sanitizePartPayload(part as unknown as Part)),
    })),
    cursor,
    complete: !cursor,
    // R2 残留: the v2 route exposes no payload-size headers, so byte-aware
    // paging degrades to record counting until the server re-adds them.
    payloadBytes: undefined,
  }
}

export async function fetchMessageHistoryPage(input: MessageHistoryPageInput): Promise<MessagePage> {
  const fetchPage = input.fetch ?? fetchSessionMessagePage
  const request: MessageHistoryFetchRequest = {
    sessionID: input.sessionID,
    directory: input.directory,
    limit: input.limit,
    before: input.before,
  }
  const run = () => {
    const pending = fetchPage(request)
    return input.requestTimeout
      ? input.requestTimeout(pending, `session.messages ${input.sessionID}`)
      : pending
  }
  let page: ClientMessagePage
  try {
    page = await retry(run)
  } catch (error) {
    const status = (error as { status?: number } | undefined)?.status
    const detail = error instanceof Error ? error.message : String(error)
    throw new MessageHistoryLoadError(`session.messages failed${status ? ` (${status})` : ""}: ${detail}`, status)
  }
  return toBoundaryPage(page)
}

export async function loadMessageHistoryBatch(input: MessageHistoryBatchInput): Promise<MessageHistoryBatchResult> {
  const fetchPage = (before: string | undefined, limit: number): Promise<MessagePage> => fetchMessageHistoryPage({
    fetch: input.fetch,
    sessionID: input.sessionID,
    directory: input.directory,
    serverId: input.serverId,
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
