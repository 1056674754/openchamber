import type { Message, Part } from "@opencode-ai/sdk/v2/client"

const STORAGE_KEY = "openchamber.liveSteerMessages.v1"

type StoredSteerMessage = {
  readonly sessionID: string
  readonly messageID: string
  readonly parentID: string
  readonly text: string
  readonly createdAt: number
  readonly providerID: string
  readonly modelID: string
  readonly agent: string
}

type StoredSteerPayload = {
  readonly version: 1
  readonly sessions: Record<string, readonly StoredSteerMessage[]>
}

export type SteerSideChannelRecord = {
  readonly info: Message
  readonly parts: Part[]
}

const emptyPayload = (): StoredSteerPayload => ({ version: 1, sessions: {} })

const hasStorage = (): boolean => typeof window !== "undefined" && typeof window.localStorage !== "undefined"

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

const readPayload = (): StoredSteerPayload => {
  if (!hasStorage()) return emptyPayload()
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return emptyPayload()
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.sessions)) {
      return emptyPayload()
    }
    const sessions: Record<string, StoredSteerMessage[]> = {}
    for (const [sessionID, entries] of Object.entries(parsed.sessions)) {
      if (!Array.isArray(entries)) continue
      const normalized = entries
        .map(normalizeStoredSteerMessage)
        .filter((entry): entry is StoredSteerMessage => entry !== null)
      if (normalized.length > 0) {
        sessions[sessionID] = normalized
      }
    }
    return { version: 1, sessions }
  } catch {
    return emptyPayload()
  }
}

const writePayload = (payload: StoredSteerPayload): void => {
  if (!hasStorage()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

const pickString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === "string" ? value : ""
}

const normalizeStoredSteerMessage = (value: unknown): StoredSteerMessage | null => {
  if (!isRecord(value)) return null
  const sessionID = pickString(value, "sessionID")
  const messageID = pickString(value, "messageID")
  const parentID = pickString(value, "parentID")
  const text = pickString(value, "text")
  const createdAt = value.createdAt
  if (!sessionID || !messageID || !parentID || !text || typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
    return null
  }
  return {
    sessionID,
    messageID,
    parentID,
    text,
    createdAt,
    providerID: pickString(value, "providerID"),
    modelID: pickString(value, "modelID"),
    agent: pickString(value, "agent"),
  }
}

export const persistSteerSideChannelMessage = (input: StoredSteerMessage): void => {
  if (!input.sessionID || !input.messageID || !input.parentID || !input.text.trim()) {
    return
  }

  const payload = readPayload()
  const current = payload.sessions[input.sessionID] ?? []
  const withoutCurrent = current.filter((entry) => entry.messageID !== input.messageID)
  const nextEntries = [...withoutCurrent, input].sort((left, right) => left.messageID.localeCompare(right.messageID))
  writePayload({
    version: 1,
    sessions: {
      ...payload.sessions,
      [input.sessionID]: nextEntries,
    },
  })
}

export const getSteerSideChannelSignature = (sessionID: string): string => {
  if (!sessionID) return ""
  const payload = readPayload()
  const entries = payload.sessions[sessionID] ?? []
  return entries.map((entry) => `${entry.messageID}:${entry.parentID}:${entry.createdAt}:${entry.text.length}`).join("|")
}

const toMessageRecord = (entry: StoredSteerMessage): Message => ({
  id: entry.messageID,
  role: "user",
  sessionID: entry.sessionID,
  parentID: entry.parentID,
  providerID: entry.providerID,
  modelID: entry.modelID,
  agent: entry.agent,
  metadata: {
    openchamberLiveSteer: true,
    openchamberDeliveryMode: "steer",
  },
  time: {
    created: entry.createdAt,
    completed: entry.createdAt,
  },
} as unknown as Message)

const toTextPart = (entry: StoredSteerMessage): Part => ({
  id: `${entry.messageID}-steer-text`,
  sessionID: entry.sessionID,
  messageID: entry.messageID,
  type: "text",
  text: entry.text,
  metadata: {
    openchamberLiveSteer: true,
  },
} as unknown as Part)

export const getMissingSteerSideChannelRecords = (
  sessionID: string,
  existingMessages: readonly Message[],
): SteerSideChannelRecord[] => {
  if (!sessionID) return []
  const existingIds = new Set(existingMessages.map((message) => message.id))
  const payload = readPayload()
  const entries = payload.sessions[sessionID] ?? []
  return entries
    .filter((entry) => !existingIds.has(entry.messageID))
    .map((entry) => ({
      info: toMessageRecord(entry),
      parts: [toTextPart(entry)],
    }))
}
