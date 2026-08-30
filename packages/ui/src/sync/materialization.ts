import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { mergeMessages } from "./optimistic"
import { getMessageFinishReason } from "@/lib/messageCompletion"
import { sanitizePartPayload } from "./sanitize"
import { compareMessagesChronologically } from './message-ordering'

const STREAMING_PART_FIELDS = ["text", "output"] as const

export type MaterializedMessageRecord = {
  info: Message
  parts: Part[]
}

export type MaterializedState = {
  message: Record<string, Message[]>
  part: Record<string, Part[]>
}

export type MaterializeSessionSnapshotsOptions = {
  skipPartTypes?: ReadonlySet<string>
  mode?: "merge" | "prepend" | "replace"
}

export type MaterializeSessionSnapshotsResult = {
  message: Record<string, Message[]>
  part: Record<string, Part[]>
  messages: Message[]
  messagesChanged: boolean
  partsChanged: boolean
}

export type SessionMaterializationStatus = {
  hasMessages: boolean
  renderable: boolean
  missingPartMessageIDs: string[]
}

function sortParts(parts: Part[], skipPartTypes: ReadonlySet<string>) {
  return parts
    .filter((part) => !!part?.id && !skipPartTypes.has(part.type))
    .map(sanitizePartPayload)
}

function normalizeMaterializedMessageInfo(info: Message, parts: Part[]): Message {
  if (info.role !== "assistant" || typeof (info as { finish?: unknown }).finish === "string") {
    return info
  }

  const finish = getMessageFinishReason(info, parts)
  if (!finish) {
    return info
  }

  return {
    ...info,
    finish,
  } as Message
}

function haveEquivalentPartSnapshots(left: Part[] | undefined, right: Part[]): boolean {
  if (!left) return false
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index += 1) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (!leftPart || !rightPart) return false
    if (leftPart.id !== rightPart.id) return false
    if (JSON.stringify(leftPart) !== JSON.stringify(rightPart)) return false
  }

  return true
}

function getPartEndTime(part: Part): number | undefined {
  const stateEnd = (part as { state?: { time?: { end?: unknown } } }).state?.time?.end
  if (typeof stateEnd === "number") {
    return stateEnd
  }

  const timeEnd = (part as { time?: { end?: unknown } }).time?.end
  return typeof timeEnd === "number" ? timeEnd : undefined
}

function getStringField(part: Part, field: "text" | "output"): string | undefined {
  const value = (part as Record<string, unknown>)[field]
  return typeof value === "string" ? value : undefined
}

function hasLiveStreamingField(part: Part): boolean {
  if (getPartEndTime(part) !== undefined) return false
  return STREAMING_PART_FIELDS.some((field) => {
    const value = getStringField(part, field)
    return typeof value === "string" && value.length > 0
  })
}

function getPartStateTime(part: Part): { start?: number; end?: number } | undefined {
  const stateTime = (part as { state?: { time?: { start?: unknown; end?: unknown } } }).state?.time
  if (!stateTime || typeof stateTime !== "object") return undefined
  const start = typeof stateTime.start === "number" ? stateTime.start : undefined
  const end = typeof stateTime.end === "number" ? stateTime.end : undefined
  if (start === undefined && end === undefined) return undefined
  return { start, end }
}

function getPartStateAttachments(part: Part): Array<unknown> | undefined {
  const state = (part as Record<string, unknown>).state as Record<string, unknown> | undefined
  if (!state) return undefined
  const attachments = state.attachments
  return Array.isArray(attachments) ? attachments : undefined
}

function mergeMaterializedPart(existing: Part | undefined, next: Part): Part {
  if (!existing) return next

  if (getPartEndTime(next) !== undefined) {
    const existingAttachments = getPartStateAttachments(existing)
    if (existingAttachments?.length && getPartStateAttachments(next) === undefined) {
      const nextRecord = { ...next }
      const nextState = {
        ...((next as Record<string, unknown>).state as Record<string, unknown> ?? {}),
        attachments: existingAttachments,
      }
      ;(nextRecord as Record<string, unknown>).state = nextState
      return nextRecord
    }
    return next
  }

  let merged: Part = next
  for (const field of STREAMING_PART_FIELDS) {
    const existingValue = getStringField(existing, field)
    if (!existingValue) continue

    const nextValue = getStringField(next, field)
    if (typeof nextValue === "string" && nextValue.length >= existingValue.length) continue
    if (typeof nextValue === "string" && nextValue.length > 0 && !existingValue.startsWith(nextValue)) continue

    if (merged === next) merged = { ...next }
    const mergedRecord = merged as Record<string, unknown>
    mergedRecord[field] = existingValue
  }

  const existingAttachments = getPartStateAttachments(existing)
  if (existingAttachments?.length && getPartStateAttachments(next) === undefined) {
    if (merged === next) merged = { ...next }
    const mergedRecord = merged as Record<string, unknown>
    const nextState = (next as Record<string, unknown>).state as Record<string, unknown> | undefined
    mergedRecord.state = { ...(nextState ?? {}), attachments: existingAttachments }
  }

  const existingTime = getPartStateTime(existing)
  if (existingTime) {
    const nextTime = getPartStateTime(next)
    const preservedStart = nextTime?.start ?? existingTime.start
    const preservedEnd = nextTime?.end ?? existingTime.end
    if (preservedStart !== nextTime?.start || preservedEnd !== nextTime?.end) {
      if (merged === next) merged = { ...next }
      const mergedRecord = merged as Record<string, unknown>
      const currentState = (mergedRecord.state as Record<string, unknown> | undefined)
        ?? (next as Record<string, unknown>).state as Record<string, unknown> | undefined
      mergedRecord.state = {
        ...(currentState ?? {}),
        time: { start: preservedStart, end: preservedEnd },
      }
    }
  }

  return merged
}

function mergeMaterializedParts(
  existing: Part[] | undefined,
  nextParts: Part[],
  skipPartTypes: ReadonlySet<string>,
  preserveLiveStreamingParts: boolean,
): Part[] {
  if (!existing || existing.length === 0) return nextParts
  if (!preserveLiveStreamingParts) return nextParts

  const existingByID = new Map(existing.map((part) => [part.id, part]))
  let mergedParts = nextParts
  let changed = false

  for (let index = 0; index < nextParts.length; index += 1) {
    const nextPart = nextParts[index]
    const mergedPart = mergeMaterializedPart(existingByID.get(nextPart.id), nextPart)
    if (mergedPart === nextPart) continue
    if (!changed) mergedParts = [...nextParts]
    mergedParts[index] = mergedPart
    changed = true
  }

  const snapshotIDs = new Set(nextParts.map((part) => part.id))
  const missingLiveParts = existing.filter(
    (part) => !!part?.id && !snapshotIDs.has(part.id) && !skipPartTypes.has(part.type) && hasLiveStreamingField(part),
  )
  if (missingLiveParts.length === 0) return mergedParts

  return [...mergedParts, ...missingLiveParts]
}

export function materializeSessionSnapshots(
  state: MaterializedState,
  sessionID: string,
  records: MaterializedMessageRecord[],
  options: MaterializeSessionSnapshotsOptions = {},
): MaterializeSessionSnapshotsResult {
  const skipPartTypes = options.skipPartTypes ?? new Set<string>()
  const snapshots = records
    .filter((record) => !!record?.info?.id)
    .map((record) => ({
      ...record,
      info: normalizeMaterializedMessageInfo(record.info, record.parts ?? []),
    }))
  snapshots.sort((left, right) => compareMessagesChronologically(left.info, right.info))
  const nextMessages = snapshots.map((record) => record.info)
  const currentMessages = state.message[sessionID] ?? []
  const isReplace = options.mode === "replace"
  const incomingByID = new Map(nextMessages.map((message) => [message.id, message] as const))
  let reconciledCurrentMessages = currentMessages
  for (let index = 0; index < currentMessages.length; index += 1) {
    const existing = currentMessages[index]
    const incoming = incomingByID.get(existing.id)
    if (
      existing.role !== "assistant"
      || existing.error?.name !== "MessageAbortedError"
      || incoming?.role !== "assistant"
      || incoming.time.completed === undefined
    ) continue
    if (reconciledCurrentMessages === currentMessages) reconciledCurrentMessages = [...currentMessages]
    reconciledCurrentMessages[index] = incoming
  }
  const messages = mergeMessages(reconciledCurrentMessages, nextMessages)
  const messagesChanged = messages !== currentMessages

  let partsChanged = false
  const nextPartState = { ...state.part }
  const isPrepend = options.mode === "prepend"

  for (const record of snapshots) {
    const messageID = record.info.id
    if (isPrepend && nextPartState[messageID]) continue

    const existing = nextPartState[messageID]
    const nextParts = mergeMaterializedParts(
      existing,
      sortParts(record.parts ?? [], skipPartTypes),
      skipPartTypes,
      record.info.role === "assistant" && !isReplace,
    )
    if (haveEquivalentPartSnapshots(existing, nextParts)) continue

    // Preserve authoritative empty snapshots: an absent key means parts have not materialized yet.
    nextPartState[messageID] = nextParts
    partsChanged = true
  }

  return {
    message: messagesChanged ? { ...state.message, [sessionID]: messages } : state.message,
    part: partsChanged ? nextPartState : state.part,
    messages,
    messagesChanged,
    partsChanged,
  }
}

export function getSessionMaterializationStatus(
  state: MaterializedState,
  sessionID: string,
): SessionMaterializationStatus {
  const messages = state.message[sessionID]
  if (!messages) {
    return { hasMessages: false, renderable: false, missingPartMessageIDs: [] }
  }

  const missingPartMessageIDs: string[] = []
  for (const message of messages) {
    if (message.role !== "assistant") continue
    const parts = state.part[message.id]
    if (!parts) {
      missingPartMessageIDs.push(message.id)
    }
  }

  return {
    hasMessages: true,
    renderable: missingPartMessageIDs.length === 0,
    missingPartMessageIDs,
  }
}
