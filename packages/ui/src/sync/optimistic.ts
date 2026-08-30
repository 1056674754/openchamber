import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { findMessageIndex, insertMessageChronologically, sortMessagesChronologically } from './message-ordering'

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id)
}

export type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

export type OptimisticItem = {
  message: Message
  parts: Part[]
}

export type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

export type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

export type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
}

const hasParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return want.length === 0
  const partIDs = new Set(parts.map((part) => part.id))
  return want.every((part) => partIDs.has(part.id))
}

const mergeParts = (parts: Part[] | undefined, want: Part[]) => {
  if (!parts) return sortParts(want)
  const next = [...parts]
  const partIDs = new Set(parts.map((part) => part.id))
  let changed = false
  for (const part of want) {
    if (partIDs.has(part.id)) continue
    partIDs.add(part.id)
    next.push(part)
    changed = true
  }
  if (!changed) return parts
  return next
}

export function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }

  const session = [...page.session]
  const messageIDs = new Set(session.map((message) => message.id))
  const part = new Map(page.part.map((item) => [item.id, sortParts(item.part)]))
  const confirmed: string[] = []

  for (const item of items) {
    const found = messageIDs.has(item.message.id)
    if (!found) {
      messageIDs.add(item.message.id)
      session.push(item.message)
    }

    const current = part.get(item.message.id)
    if (found && hasParts(current, item.parts)) {
      confirmed.push(item.message.id)
      continue
    }

    part.set(item.message.id, mergeParts(current, item.parts))
  }

  return {
    cursor: page.cursor,
    complete: page.complete,
    session: sortMessagesChronologically(session),
    part: [...part.entries()]
      .map(([id, part]) => ({ id, part })),
    confirmed,
  }
}

/** Apply optimistic add to a mutable draft (for immer/produce) */
export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    if (findMessageIndex(messages, input.message.id) < 0) insertMessageChronologically(messages, input.message)
  } else {
    draft.message[input.sessionID] = [input.message]
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

/** Apply optimistic remove to a mutable draft (for immer/produce) */
export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const messageIndex = findMessageIndex(messages, input.messageID)
    if (messageIndex >= 0) messages.splice(messageIndex, 1)
  }
  delete draft.part[input.messageID]
}

/** Merge two sorted message arrays by id, deduplicating.
 *  Items from `b` replace matching items from `a` (same id, different
 *  reference) so that server-side updates propagate on refresh. */
export function mergeMessages<T extends Message>(a: readonly T[], b: readonly T[]) {
  const existing = new Map(a.map((item) => [item.id, item] as const))
  let changed = false
  for (const item of b) {
    const prev = existing.get(item.id)
    if (!prev) {
      existing.set(item.id, item)
      changed = true
    }
  }
  if (!changed) return a as T[]
  return sortMessagesChronologically([...existing.values()])
}
