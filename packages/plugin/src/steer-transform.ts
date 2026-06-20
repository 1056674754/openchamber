/**
 * Runtime shim for OpenCode steer delivery.
 *
 * OpenCode can admit steer prompts without promoting them into the next model
 * request. We do not write OpenCode's event-sourced database from the plugin;
 * instead, we inject admitted live steers into the in-memory message batch that
 * is about to be converted into model messages.
 */

import type { Hooks } from "@opencode-ai/plugin"

import { log } from "./logger.js"

type PendingSteer = {
  readonly messageID: string
  readonly sessionID: string
  readonly text: string
  readonly admittedAt: number
  injected: boolean
}

type MessagePart = {
  readonly sessionID?: string
  readonly messageID?: string
  readonly type?: string
  readonly text?: string
  readonly [key: string]: unknown
}

type MessageWithParts = {
  readonly info: {
    readonly id?: string
    readonly role?: string
    readonly sessionID?: string
    readonly [key: string]: unknown
  }
  readonly parts: MessagePart[]
}

type MessagesTransformOutput = {
  messages: MessageWithParts[]
}

type PluginEvent = {
  readonly type?: string
  readonly properties?: unknown
}

const MAX_PENDING_PER_SESSION = 25
const MAX_SESSIONS = 50
const ADMITTED_TYPES = new Set(["session.next.prompt.admitted", "session.next.prompt.admitted.1"])
const PROMOTED_TYPES = new Set(["session.next.prompt.promoted", "session.next.prompt.promoted.1"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function promptText(properties: Record<string, unknown>): string | undefined {
  const prompt = properties.prompt
  if (!isRecord(prompt)) return undefined
  const text = prompt.text
  return typeof text === "string" && text.trim().length > 0 ? text : undefined
}

function inferSessionID(messages: readonly MessageWithParts[]): string | undefined {
  const sessionIDs = new Set<string>()

  for (const message of messages) {
    if (typeof message.info.sessionID === "string" && message.info.sessionID.length > 0) {
      sessionIDs.add(message.info.sessionID)
    }
    for (const part of message.parts) {
      if (typeof part.sessionID === "string" && part.sessionID.length > 0) {
        sessionIDs.add(part.sessionID)
      }
    }
  }

  return sessionIDs.size === 1 ? Array.from(sessionIDs)[0] : undefined
}

function messageIDs(messages: readonly MessageWithParts[]): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (typeof message.info.id === "string" && message.info.id.length > 0) ids.add(message.info.id)
    for (const part of message.parts) {
      if (typeof part.messageID === "string" && part.messageID.length > 0) ids.add(part.messageID)
    }
  }
  return ids
}

function buildSteerText(item: PendingSteer): string {
  return [
    "<system-reminder>",
    "The user sent the following live steering message while the current response was already running:",
    item.text,
    "",
    "Treat this as the latest user direction and continue the current task accordingly.",
    "</system-reminder>",
  ].join("\n")
}

function buildSyntheticMessage(item: PendingSteer): MessageWithParts {
  return {
    info: {
      id: item.messageID,
      role: "user",
      sessionID: item.sessionID,
      time: {
        created: item.admittedAt,
      },
      metadata: {
        openchamberLiveSteer: true,
      },
    },
    parts: [
      {
        id: `${item.messageID}-openchamber-steer`,
        messageID: item.messageID,
        sessionID: item.sessionID,
        type: "text",
        text: buildSteerText(item),
        synthetic: true,
      },
    ],
  }
}

function appendWithLimits(pendingBySession: Map<string, PendingSteer[]>, item: PendingSteer): void {
  const next = pendingBySession.get(item.sessionID)?.filter((pending) => pending.messageID !== item.messageID) ?? []
  next.push(item)
  if (next.length > MAX_PENDING_PER_SESSION) {
    next.splice(0, next.length - MAX_PENDING_PER_SESSION)
  }
  pendingBySession.set(item.sessionID, next)

  if (pendingBySession.size <= MAX_SESSIONS) return
  const firstSession = pendingBySession.keys().next().value
  if (typeof firstSession === "string") pendingBySession.delete(firstSession)
}

function removePending(pendingBySession: Map<string, PendingSteer[]>, sessionID: string, messageID: string): void {
  const existing = pendingBySession.get(sessionID)
  if (!existing) return
  const next = existing.filter((item) => item.messageID !== messageID)
  if (next.length === 0) pendingBySession.delete(sessionID)
  else pendingBySession.set(sessionID, next)
}

export function createSteerTransformHandler(): {
  readonly event: NonNullable<Hooks["event"]>
  readonly messages: NonNullable<Hooks["experimental.chat.messages.transform"]>
} {
  const runtime = createSteerTransformRuntime()

  const event: NonNullable<Hooks["event"]> = async (input): Promise<void> => {
    runtime.recordEvent(input.event as PluginEvent)
  }

  const messages: NonNullable<Hooks["experimental.chat.messages.transform"]> = async (
    _input,
    output,
  ): Promise<void> => {
    runtime.injectMessages(output as MessagesTransformOutput)
  }

  return { event, messages }
}

export function createSteerTransformRuntime(): {
  readonly recordEvent: (pluginEvent: PluginEvent) => void
  readonly injectMessages: (output: MessagesTransformOutput) => void
} {
  const pendingBySession = new Map<string, PendingSteer[]>()

  function recordEvent(pluginEvent: PluginEvent): void {
    const type = pluginEvent.type
    const properties = isRecord(pluginEvent.properties) ? pluginEvent.properties : undefined
    if (!type || !properties) return

    const sessionID = stringField(properties, "sessionID")
    const messageID = stringField(properties, "messageID")
    if (!sessionID || !messageID) return

    if (ADMITTED_TYPES.has(type)) {
      if (properties.delivery !== "steer") return
      const text = promptText(properties)
      if (!text) return
      appendWithLimits(pendingBySession, {
        messageID,
        sessionID,
        text,
        admittedAt: Date.now(),
        injected: false,
      })
      log("[steer-transform] admitted live steer", { sessionID, messageID })
      return
    }

    if (PROMOTED_TYPES.has(type)) {
      removePending(pendingBySession, sessionID, messageID)
    }
  }

  function injectMessages(typedOutput: MessagesTransformOutput): void {
    if (!Array.isArray(typedOutput.messages)) return

    const sessionID = inferSessionID(typedOutput.messages)
    if (!sessionID) return

    const pending = pendingBySession.get(sessionID)
    if (!pending || pending.length === 0) return

    const existingIDs = messageIDs(typedOutput.messages)
    const toInject = pending.filter((item) => !item.injected && !existingIDs.has(item.messageID))
    if (toInject.length === 0) return

    typedOutput.messages.push(...toInject.map(buildSyntheticMessage))
    for (const item of toInject) {
      item.injected = true
    }
    log("[steer-transform] injected live steers into model context", {
      sessionID,
      count: toInject.length,
      messageIDs: toInject.map((item) => item.messageID),
    })
  }

  return { recordEvent, injectMessages }
}
