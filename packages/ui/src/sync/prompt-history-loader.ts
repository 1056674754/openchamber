import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { isRealUserMessage } from "@/lib/messages/real-user"
import {
  fetchMessageHistoryPage,
  type MessageHistoryPageInput,
} from "./message-history-loader"
import { mergeOlderMessagePage, type MessagePage } from "./message-page-boundary"
import { compareMessagesChronologically } from './message-ordering'

export type UserPromptHistoryRecord = {
  readonly info: Message
  readonly parts: readonly Part[]
}

export type CompleteUserPromptHistoryResult = {
  readonly records: readonly UserPromptHistoryRecord[]
  readonly complete: boolean
}

export type CompleteUserPromptHistoryInput = MessageHistoryPageInput & {
  readonly isCancelled?: () => boolean
  readonly onProgress?: (result: CompleteUserPromptHistoryResult) => void
}


const collectUserPrompts = (
  page: MessagePage,
  records: Map<string, UserPromptHistoryRecord>,
): void => {
  const partsByMessageID = new Map(page.part.map((item) => [item.id, item.part]))
  for (const info of page.session) {
    const parts = partsByMessageID.get(info.id) ?? []
    if (!isRealUserMessage(info, parts)) continue
    records.set(info.id, { info, parts })
  }
}

const toCompleteResult = (
  records: Map<string, UserPromptHistoryRecord>,
  complete: boolean,
): CompleteUserPromptHistoryResult => ({
  records: [...records.values()].sort((left, right) => compareMessagesChronologically(left.info, right.info)),
  complete,
})

export async function loadCompleteUserPromptHistory(
  input: CompleteUserPromptHistoryInput,
): Promise<CompleteUserPromptHistoryResult> {
  const records = new Map<string, UserPromptHistoryRecord>()
  const seenCursors = new Set<string>()
  let before = input.before
  let complete = false

  while (!input.isCancelled?.()) {
    const page = await fetchMessageHistoryPage({ ...input, before })
    collectUserPrompts(page, records)
    complete = page.complete
    const result = toCompleteResult(records, complete)
    input.onProgress?.(result)

    if (complete || !page.cursor || seenCursors.has(page.cursor)) return result
    seenCursors.add(page.cursor)
    before = page.cursor
  }

  return toCompleteResult(records, false)
}

export async function loadMessageHistoryThroughTarget(
  input: MessageHistoryPageInput & {
    readonly targetMessageID: string
  },
): Promise<{ readonly page: MessagePage; readonly found: boolean }> {
  const seenCursors = new Set<string>()
  let page = await fetchMessageHistoryPage(input)
  let found = page.session.some((message) => message.id === input.targetMessageID)

  while (!found && !page.complete && page.cursor && !seenCursors.has(page.cursor)) {
    seenCursors.add(page.cursor)
    const older = await fetchMessageHistoryPage({ ...input, before: page.cursor })
    found = older.session.some((message) => message.id === input.targetMessageID)
    page = mergeOlderMessagePage(page, older)
  }

  return { page, found }
}
