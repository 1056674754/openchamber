import type { Message, Part } from "@opencode-ai/sdk/v2/client"

import { hasRealUserMessageParts } from "@/lib/messages/real-user"

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export const MESSAGE_USER_BOUNDARY_EXTRA_PAGE_LIMIT = 4
export const MESSAGE_USER_BOUNDARY_RECORD_LIMIT = 600

export type MessagePage = {
  session: Message[]
  part: Array<{ id: string; part: Part[] }>
  cursor: string | undefined
  complete: boolean
}

const isUserMessage = (message: Message): boolean => {
  const info = message as Message & { clientRole?: unknown; role?: unknown }
  const role = typeof info.clientRole === "string" ? info.clientRole : info.role
  return role === "user"
}

export const isRealUserMessage = (message: Message, parts: Part[] | undefined): boolean => {
  return isUserMessage(message) && hasRealUserMessageParts(parts, message)
}

export const getPageParts = (page: Pick<MessagePage, "part">, messageID: string): Part[] | undefined => {
  return page.part.find((item) => item.id === messageID)?.part
}

export const hasUserBoundary = (page: Pick<MessagePage, "session" | "part">): boolean => {
  const oldest = page.session[0]
  return Boolean(oldest && isRealUserMessage(oldest, getPageParts(page, oldest.id)))
}

export const mergeOlderMessagePage = (page: MessagePage, older: MessagePage): MessagePage => ({
  session: [...older.session, ...page.session].sort((left, right) => cmp(left.id, right.id)),
  part: [...older.part, ...page.part],
  cursor: older.cursor,
  complete: older.complete,
})

export async function fetchMessagePageToUserBoundary(input: {
  page: MessagePage
  fetchOlder: (cursor: string) => Promise<MessagePage>
  maxExtraPages?: number
  maxRecords?: number
}): Promise<{ page: MessagePage; extraPages: number; stoppedBeforeBoundary: boolean }> {
  let page = input.page
  const seenCursors = new Set<string>()
  let extraPages = 0
  const maxExtraPages = input.maxExtraPages ?? MESSAGE_USER_BOUNDARY_EXTRA_PAGE_LIMIT
  const maxRecords = input.maxRecords ?? MESSAGE_USER_BOUNDARY_RECORD_LIMIT

  while (
    !page.complete
    && page.cursor
    && !hasUserBoundary(page)
    && page.session.length < maxRecords
    && extraPages < maxExtraPages
  ) {
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

  return {
    page,
    extraPages,
    stoppedBeforeBoundary: !page.complete && !hasUserBoundary(page),
  }
}
