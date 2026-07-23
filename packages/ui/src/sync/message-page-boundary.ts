import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { isRealUserMessage } from "@/lib/messages/real-user"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export const MESSAGE_USER_BOUNDARY_EXTRA_PAGE_LIMIT = 4
export const MESSAGE_USER_BOUNDARY_RECORD_LIMIT = 600
export const MESSAGE_USER_BOUNDARY_BYTE_AWARE_EXTRA_PAGE_LIMIT = 32
export const MESSAGE_USER_BOUNDARY_BYTE_AWARE_RECORD_LIMIT = 5_000
export const MESSAGE_USER_BOUNDARY_PAYLOAD_BYTE_LIMIT = 8_000_000

export type MessagePage = {
  session: Message[]
  part: Array<{ id: string; part: Part[] }>
  cursor: string | undefined
  complete: boolean
  payloadBytes?: number
}

export const getPageParts = (page: Pick<MessagePage, "part">, messageID: string): Part[] | undefined => {
  return page.part.find((item) => item.id === messageID)?.part
}

export const hasUserBoundary = (page: Pick<MessagePage, "session" | "part">): boolean => {
  const partsByMessageID = new Map(page.part.map((item) => [item.id, item.part]))
  return page.session.some((message) => isRealUserMessage(message, partsByMessageID.get(message.id)))
}

export const countUserBoundaries = (page: Pick<MessagePage, "session" | "part">): number => {
  const partsByMessageID = new Map(page.part.map((item) => [item.id, item.part]))
  return page.session.filter((message) => isRealUserMessage(message, partsByMessageID.get(message.id))).length
}

const getUserBoundaryIndexes = (page: Pick<MessagePage, "session" | "part">): number[] => {
  const partsByMessageID = new Map(page.part.map((item) => [item.id, item.part]))
  const indexes: number[] = []
  page.session.forEach((message, index) => {
    if (isRealUserMessage(message, partsByMessageID.get(message.id))) {
      indexes.push(index)
    }
  })
  return indexes
}

export const mergeOlderMessagePage = (page: MessagePage, older: MessagePage): MessagePage => ({
  session: [...older.session, ...page.session].sort((left, right) => cmp(left.id, right.id)),
  part: [...older.part, ...page.part],
  cursor: older.cursor,
  complete: older.complete,
  payloadBytes: typeof page.payloadBytes === "number" && typeof older.payloadBytes === "number"
    ? page.payloadBytes + older.payloadBytes
    : undefined,
})

export async function fetchMessagePageToUserBoundary(input: {
  page: MessagePage
  fetchOlder: (cursor: string) => Promise<MessagePage>
  refetchFromStart?: (limit: number) => Promise<MessagePage>
  minimumRealUserMessages?: number
  maxExtraPages?: number
  maxRecords?: number
  maxPayloadBytes?: number
}): Promise<{ page: MessagePage; extraPages: number; stoppedBeforeBoundary: boolean }> {
  let page = input.page
  const seenCursors = new Set<string>()
  let extraPages = 0
  const minimumRealUserMessages = Math.max(1, Math.floor(input.minimumRealUserMessages ?? 1))
  const maxPayloadBytes = input.maxPayloadBytes ?? MESSAGE_USER_BOUNDARY_PAYLOAD_BYTE_LIMIT

  while (!page.complete && page.cursor && countUserBoundaries(page) < minimumRealUserMessages) {
    const payloadBytes = page.payloadBytes
    const hasPayloadBytes = typeof payloadBytes === "number" && Number.isFinite(payloadBytes)
    const maxExtraPages = input.maxExtraPages ?? (
      hasPayloadBytes ? MESSAGE_USER_BOUNDARY_BYTE_AWARE_EXTRA_PAGE_LIMIT : MESSAGE_USER_BOUNDARY_EXTRA_PAGE_LIMIT
    )
    const maxRecords = input.maxRecords ?? (
      hasPayloadBytes ? MESSAGE_USER_BOUNDARY_BYTE_AWARE_RECORD_LIMIT : MESSAGE_USER_BOUNDARY_RECORD_LIMIT
    )
    if (
      page.session.length >= maxRecords
      || extraPages >= maxExtraPages
      || (typeof payloadBytes === "number" && Number.isFinite(payloadBytes) && payloadBytes >= maxPayloadBytes)
    ) {
      break
    }

    if (seenCursors.has(page.cursor)) {
      break
    }
    seenCursors.add(page.cursor)
    extraPages += 1

    const older = await input.fetchOlder(page.cursor)
    if (older.session.length === 0 && older.cursor === page.cursor) {
      break
    }

    page = mergeOlderMessagePage(page, older)
  }

  const boundaryIndexes = getUserBoundaryIndexes(page)
  const selectedBoundaryOffset = boundaryIndexes.length - minimumRealUserMessages
  const selectedBoundaryIndex = selectedBoundaryOffset >= 0
    ? boundaryIndexes[selectedBoundaryOffset]
    : undefined
  const shouldAlignToBoundary = typeof selectedBoundaryIndex === "number"
    && selectedBoundaryIndex > 0
    && (boundaryIndexes.length > minimumRealUserMessages || !page.complete)

  if (shouldAlignToBoundary && input.refetchFromStart) {
    const expectedBoundaryID = page.session[selectedBoundaryIndex]?.id
    const exactRecordLimit = page.session.length - selectedBoundaryIndex
    const aligned = await input.refetchFromStart(exactRecordLimit)
    if (expectedBoundaryID && aligned.session[0]?.id === expectedBoundaryID) {
      page = aligned
    }
  }

  return {
    page,
    extraPages,
    stoppedBeforeBoundary: !page.complete && countUserBoundaries(page) < minimumRealUserMessages,
  }
}
