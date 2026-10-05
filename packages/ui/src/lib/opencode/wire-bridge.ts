/**
 * v2 wire → fork reducer vocabulary (OC2 spine S6, boundary-translation
 * decision §1). The browser receives the RAW OpenCode 2.x wire payloads —
 * the server's own consumers are translated by
 * `packages/web/server/lib/event-stream/translate-v2.js`, and this module is
 * the UI-side counterpart, mapped onto what the fork's existing
 * reducer/store actually consume instead of upstream's SyncEvent rewrite.
 *
 * Pure functions only: no store access, no transport. The pipeline calls this
 * before coalescing, so a v2 stream coalesces exactly like a v1 one (delta
 * keys are identical by construction).
 *
 * Three vocabularies meet here:
 * - v2 wire (input): `{ type, id, created, location?, data }` records.
 * - fork v1 events (output): the `@opencode-ai/sdk` shapes the reducer
 *   switches on (`session.created`, `message.part.updated`, ...).
 * - fork-adjacent bridge events (output): names the v1 wire never emits
 *   and the reducer gained v2-only cases for — `session.patched` and
 *   `message.patched` (partial records: v2 patches, v1 replaces),
 *   `message.tool.transition` (a tool part's next state without a full part),
 *   `message.record` / `message.record.delta` (the plumbing/shell/compaction
 *   transcript records the fork store keeps on the `nativeRecords` channel —
 *   the fork message store is user/assistant-shaped, so these roles never
 *   enter it). The `catalog.updated` carrier is consumed in sync-context
 *   before the reducer (store refresh), never reduced.
 *
 * Deliberately not translated (single-point registrations, MERGE evidence):
 * `location.shutdown` (the fork's refresh callback is not wired for
 * server.instance.disposed either) and `session.viewed`.
 */

import type { Event, Message, Part, Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import type { SessionStructuredError, ToolContent } from "@opencode/client"
import { partIds } from "./model"
import { structuredErrorText, toolAttachments, toolOutputText } from "./projection"

/**
 * The raw tool `content` and `error` fields on the wire are the same shapes
 * `@opencode/client` types as `ToolContent[]` / `SessionStructuredError`; the
 * bridge reads them untyped, so the S5 projection helpers are fed through one
 * cast point each.
 */
const asToolContent = (value: unknown): readonly ToolContent[] | undefined =>
  Array.isArray(value) ? (value as unknown as readonly ToolContent[]) : undefined

const asStructuredError = (value: unknown): SessionStructuredError => value as unknown as SessionStructuredError

// ---------------------------------------------------------------------------
// Output vocabulary
// ---------------------------------------------------------------------------

/** Partial session fields; the reducer merges into the stored session. */
export type SessionBridgePatch = {
  title?: string
  directory?: string
  projectID?: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
  cost?: number
  tokens?: unknown
  permissions?: unknown
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string } | null
  time?: { created?: number; updated?: number; idle?: number }
}

/** Partial message fields; the reducer merges into the stored message. */
export type MessageBridgePatch = {
  role?: "assistant" | "user"
  agent?: string
  providerID?: string
  modelID?: string
  variant?: string
  finish?: string
  error?: { name?: string; type?: string; message?: string } | null
  cost?: number
  tokens?: unknown
  snapshot?: { start?: string; end?: string; files?: string[] }
  retry?: { attempt: number; at: number; error?: unknown } | null
  time?: { created?: number; streamed?: number; completed?: number }
}

export type ToolBridgeTransition =
  | { kind: "input"; raw: string }
  | { kind: "called"; input: Record<string, unknown>; executed: boolean; start: number }
  | { kind: "progress"; metadata?: Record<string, unknown> }
  | {
      kind: "success"
      output: string
      attachments?: Part[]
      metadata?: Record<string, unknown>
      executed: boolean
      end: number
    }
  | {
      kind: "failed"
      error: string
      output?: string
      metadata?: Record<string, unknown>
      executed: boolean
      end: number
    }

export type CatalogBridgeKind =
  | "config"
  | "agent"
  | "command"
  | "skill"
  | "plugin"
  | "provider"
  | "model"
  | "credential"
  | "project"

/**
 * A v2-native transcript record the fork store keeps on the side (`State`
 * `nativeRecords`): plumbing notices, shells and compactions. Mirrors
 * `NativeSessionRecord` in `sync/types` (kept structurally identical).
 */
export type RecordBridgeRole =
  | "synthetic"
  | "system"
  | "skill"
  | "shell"
  | "compaction"
  | "location-switched"
  | "agent-switched"
  | "model-switched"

export type RecordBridgePayload = {
  id: string
  role: RecordBridgeRole
  time?: { created?: number; completed?: number }
  text?: string
  description?: string
  skill?: string
  name?: string
  directory?: string
  agent?: string
  previous?: unknown
  model?: unknown
  shellID?: string
  command?: string
  status?: string
  exit?: number | null
  output?: string
  compactionStatus?: "running" | "completed" | "failed"
  reason?: string
  summary?: string
  error?: unknown
  cost?: number
}

/**
 * Everything the bridge can emit. A discriminated superset of the fork `Event`
 * union — the extra members are the fork-adjacent names above, which v1 never
 * produces and the reducer/sync-context branch on by string.
 */
export type BridgeEvent =
  | Event
  | { type: "session.patched"; properties: { sessionID: string; patch: SessionBridgePatch } }
  | { type: "message.patched"; properties: { sessionID: string; messageID: string; patch: MessageBridgePatch } }
  | {
      type: "message.tool.transition"
      properties: { sessionID: string; messageID: string; partID: string; transition: ToolBridgeTransition }
    }
  | { type: "message.record"; properties: { sessionID: string; record: RecordBridgePayload } }
  | { type: "message.record.delta"; properties: { sessionID: string; delta: string } }
  | { type: "catalog.updated"; properties: { kind: CatalogBridgeKind } }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const trimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

const compact = <T extends Record<string, unknown>>(value: T): T => {
  const result = {} as T
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key as keyof T] = entry as T[keyof T]
  }
  return result
}

type WirePayload = {
  id?: unknown
  type?: unknown
  created?: unknown
  location?: unknown
  data?: unknown
}

const wireTime = (payload: WirePayload): number =>
  typeof payload.created === "number" && Number.isFinite(payload.created) ? payload.created : Date.now()

const wireData = (payload: WirePayload): Record<string, unknown> => (isRecord(payload.data) ? payload.data : {})

const wireDirectory = (payload: WirePayload): string => {
  if (!isRecord(payload.location)) return ""
  return trimmed((payload.location as { directory?: unknown }).directory)
}

const wireSessionId = (data: Record<string, unknown>): string => trimmed(data.sessionID)

const wireMessageId = (data: Record<string, unknown>, key = "assistantMessageID"): string => trimmed(data[key])

const toServerError = (error: unknown): { name: string; type: string; message: string } => {
  if (isRecord(error)) {
    const type = trimmed(error.type) || "Error"
    return { name: type, type, message: trimmed(error.message) }
  }
  return { name: "Error", type: "Error", message: typeof error === "string" ? error : "" }
}

const ABORTED_ERROR = { name: "MessageAbortedError", type: "MessageAbortedError", message: "The running turn was interrupted." }

const wireTokens = (data: Record<string, unknown>): unknown => {
  if (!isRecord(data.tokens)) return undefined
  return data.tokens
}

const wireModelRef = (data: Record<string, unknown>, key = "model"): { providerID: string; modelID: string; variant?: string } | undefined => {
  const model = data[key]
  if (!isRecord(model)) return undefined
  const providerID = trimmed(model.providerID)
  const modelID = trimmed(model.id)
  if (!providerID || !modelID) return undefined
  return compact({ providerID, modelID, variant: trimmed(model.variant) || undefined })
}

const event = (outType: string, properties: Record<string, unknown>, source: WirePayload): BridgeEvent =>
  ({
    type: outType,
    id: typeof source.id === "string" ? source.id : "",
    properties,
  }) as unknown as BridgeEvent

/** v1 Part envelope for one projected part. */
const partEvent = (sessionID: string, part: Part, source: WirePayload): BridgeEvent =>
  event("message.part.updated", { sessionID, part }, source)

const partBase = (sessionID: string, messageID: string, id: string, extra: Record<string, unknown>): Part =>
  ({ id, sessionID, messageID, ...extra }) as unknown as Part

/**
 * v2 permission asks travel as `{ id, sessionID, action, resources, save?, ... }`;
 * the fork's permission surfaces read the v1 names (`permission`, `patterns`,
 * `always`). The v2 fields ride along untouched for the S7 dock.
 */
const normalizePermissionProperties = (data: Record<string, unknown>): Record<string, unknown> => ({
  ...data,
  permission: typeof data.permission === "string" ? data.permission : trimmed(data.action),
  patterns: Array.isArray(data.patterns) ? data.patterns : Array.isArray(data.resources) ? data.resources : [],
  always: Array.isArray(data.always) ? data.always : Array.isArray(data.save) ? data.save : [],
})

// --- transcript records (plumbing roles, shells, compactions) ---------------

/** Upstream's derivation: a record's id comes from its announcing event id. */
const messageIdFromWireEvent = (source: WirePayload): string =>
  typeof source.id === "string" ? source.id.replace(/^evt_/, "msg_") : ""

const finiteExit = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const recordEvent = (sessionID: string, record: RecordBridgePayload, source: WirePayload): BridgeEvent =>
  event("message.record", { sessionID, record }, source)

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * Translates one raw v2 wire payload into zero or more events in the fork's
 * reducer vocabulary. Unknown and deliberately-unmodeled types return `[]`.
 */
export function translateV2WireEvent(payload: unknown): BridgeEvent[] {
  if (!isRecord(payload)) return []
  const wire = payload as WirePayload
  const type = trimmed(wire.type)
  if (!type) return []

  // OpenChamber's own frames ride the same stream in both modes and are
  // consumed verbatim by the pipeline/sync-context; never translated.
  if (type.startsWith("openchamber:")) return [payload as BridgeEvent]

  const data = wireData(wire)
  const sessionID = wireSessionId(data)
  const now = wireTime(wire)
  const directory = wireDirectory(wire)
  const withDirectory = (properties: Record<string, unknown>): Record<string, unknown> =>
    directory ? { directory, ...properties } : properties

  const status = (statusValue: SessionStatus): BridgeEvent[] => [
    event("session.status", { sessionID, status: statusValue }, wire),
  ]

  switch (type) {
    // --- server ------------------------------------------------------------

    case "server.connected":
      return [event("server.connected", {}, wire)]

    case "installation.update-available": {
      const version = trimmed(data.version)
      return version ? [event("installation.update-available", { version }, wire)] : []
    }

    // --- session lifecycle ---------------------------------------------------

    case "session.created": {
      if (!sessionID) return []
      const info = compact({
        id: sessionID,
        parentID: trimmed(data.parentID) || undefined,
        projectID: trimmed(data.projectID) || undefined,
        directory: directory || undefined,
        title: typeof data.title === "string" ? data.title : "",
        agent: trimmed(data.agent) || undefined,
        model: wireModelRef(data),
        cost: 0,
        tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        metadata: isRecord(data.metadata) ? data.metadata : undefined,
        permissions: data.permissions,
        time: { created: now, updated: now },
      }) as unknown as Session
      return [event("session.created", withDirectory({ info }), wire)]
    }

    case "session.deleted":
      if (!sessionID) return []
      return [event("session.deleted", withDirectory({ sessionID }), wire)]

    case "session.renamed": {
      if (!sessionID) return []
      const title = typeof data.title === "string" ? data.title : undefined
      return [event("session.patched", withDirectory({ sessionID, patch: compact({ title, time: { updated: now } }) }), wire)]
    }

    case "session.moved": {
      if (!sessionID) return []
      return [
        event(
          "session.patched",
          withDirectory({
            sessionID,
            patch: compact({ directory: directory || undefined, projectID: trimmed(data.projectID) || undefined, time: { updated: now } }),
          }),
          wire,
        ),
        ...(directory
          ? [recordEvent(sessionID, {
            id: messageIdFromWireEvent(wire),
            role: "location-switched",
            time: { created: now },
            directory,
          }, wire)]
          : []),
      ]
    }

    case "session.usage.updated": {
      if (!sessionID) return []
      return [
        event(
          "session.patched",
          withDirectory({ sessionID, patch: compact({ cost: data.cost, tokens: wireTokens(data), time: { updated: now } }) }),
          wire,
        ),
      ]
    }

    case "session.permissions":
      if (!sessionID) return []
      return [event("session.patched", withDirectory({ sessionID, patch: { permissions: data.permissions } }), wire)]

    case "session.agent.selected": {
      if (!sessionID) return []
      const agent = trimmed(data.agent)
      if (!agent) return []
      return [
        event("session.patched", withDirectory({ sessionID, patch: { agent } }), wire),
        recordEvent(sessionID, {
          id: messageIdFromWireEvent(wire),
          role: "agent-switched",
          time: { created: now },
          agent,
          previous: data.previous,
        }, wire),
      ]
    }

    case "session.model.selected": {
      if (!sessionID) return []
      const model = wireModelRef(data)
      if (!model) return []
      return [
        event("session.patched", withDirectory({ sessionID, patch: { model } }), wire),
        recordEvent(sessionID, {
          id: messageIdFromWireEvent(wire),
          role: "model-switched",
          time: { created: now },
          model: data.model,
          previous: data.previous,
        }, wire),
      ]
    }

    case "session.revert.staged":
      if (!sessionID || !isRecord(data.revert)) return []
      return [event("session.patched", withDirectory({ sessionID, patch: { revert: data.revert as SessionBridgePatch["revert"] } }), wire)]

    case "session.revert.cleared":
    case "session.revert.committed":
      // `committed` trims server-side without message.removed follow-ups; the
      // next session fetch reconciles what the store still holds.
      if (!sessionID) return []
      return [event("session.patched", withDirectory({ sessionID, patch: { revert: null } }), wire)]

    // --- live status ---------------------------------------------------------
    // v2 declares `session.status`/`session.idle` but a real server drives
    // status from `session.execution.*`; both are translated, mirroring the
    // server-side translate-v2 semantics.

    case "session.status": {
      if (!sessionID || !isRecord(data.status)) return []
      return status(data.status as SessionStatus)
    }

    case "session.idle":
      if (!sessionID) return []
      return [...status({ type: "idle" }), event("session.idle", withDirectory({ sessionID }), wire)]

    case "session.execution.started":
      if (!sessionID) return []
      return status({ type: "busy" })

    case "session.execution.succeeded":
      if (!sessionID) return []
      return [...status({ type: "idle" }), event("session.idle", withDirectory({ sessionID }), wire)]

    case "session.execution.interrupted": {
      if (!sessionID) return []
      // A shutdown keeps the execution claim — OpenCode resumes the same turn
      // after restart, so the session stays busy (server translate semantics).
      if (trimmed(data.reason) === "shutdown") return []
      return [
        ...status({ type: "idle" }),
        event("session.idle", withDirectory({ sessionID, aborted: true, reason: trimmed(data.reason) || "user", error: ABORTED_ERROR }), wire),
      ]
    }

    case "session.execution.failed":
      if (!sessionID) return []
      return [...status({ type: "idle" }), event("session.error", withDirectory({ sessionID, error: toServerError(data.error) }), wire)]

    // --- inbox (queued/steered user input) -----------------------------------

    case "session.inbox.enqueued": {
      if (!sessionID) return []
      const messageID = trimmed(data.inboxID)
      const item = isRecord(data.item) ? data.item : {}
      const itemPayload = isRecord(item.payload) ? item.payload : {}
      // Synthetic inbox items (loop continuations, plan injections) are
      // plumbing records, not prompts the user typed.
      if (messageID && item.type === "synthetic") {
        return [recordEvent(sessionID, {
          id: messageIdFromWireEvent(wire) || messageID,
          role: "synthetic",
          time: { created: now },
          text: typeof itemPayload.text === "string" ? itemPayload.text : "",
          description: typeof itemPayload.description === "string" ? itemPayload.description : undefined,
        }, wire)]
      }
      if (!messageID || item.type !== "user") return []
      const text = typeof itemPayload.text === "string" ? itemPayload.text : ""
      const info = compact({
        id: messageID,
        sessionID,
        role: "user",
        time: { created: now },
        metadata: isRecord(itemPayload.metadata) ? itemPayload.metadata : undefined,
      }) as unknown as Message
      const part = partBase(sessionID, messageID, partIds.userText(messageID), compact({
        type: "text",
        text,
        time: { start: now },
      }))
      return [
        event("message.updated", withDirectory({ info }), wire),
        partEvent(sessionID, part, wire),
      ]
    }

    case "session.inbox.delivered": {
      if (!sessionID) return []
      const messageID = trimmed(data.inboxID)
      if (!messageID) return []
      return [event("message.patched", withDirectory({ sessionID, messageID, patch: { time: { created: now } } }), wire)]
    }

    case "session.inbox.cancelled": {
      if (!sessionID) return []
      const messageID = trimmed(data.inboxID)
      if (!messageID) return []
      return [event("message.removed", withDirectory({ sessionID, messageID }), wire)]
    }

    // --- assistant steps -------------------------------------------------------

    case "session.step.started": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      if (!messageID) return []
      return [
        event(
          "message.patched",
          withDirectory({
            sessionID,
            messageID,
            patch: compact({
              role: "assistant",
              agent: trimmed(data.agent) || undefined,
              providerID: wireModelRef(data)?.providerID,
              modelID: wireModelRef(data)?.modelID,
              variant: wireModelRef(data)?.variant,
              time: { created: now },
              snapshot: typeof data.snapshot === "string" ? { start: data.snapshot } : undefined,
            }),
          }),
          wire,
        ),
      ]
    }

    case "session.step.streamed": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      if (!messageID) return []
      return [event("message.patched", withDirectory({ sessionID, messageID, patch: { time: { streamed: now } } }), wire)]
    }

    case "session.step.ended": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      if (!messageID) return []
      return [
        event(
          "message.patched",
          withDirectory({
            sessionID,
            messageID,
            patch: compact({
              finish: trimmed(data.finish) || undefined,
              cost: data.cost,
              tokens: wireTokens(data),
              retry: null,
              time: { completed: now },
              snapshot: typeof data.snapshot === "string" ? compact({ end: data.snapshot, files: Array.isArray(data.files) ? data.files : undefined }) : undefined,
            }),
          }),
          wire,
        ),
      ]
    }

    case "session.step.failed": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      if (!messageID) return []
      return [
        event(
          "message.patched",
          withDirectory({
            sessionID,
            messageID,
            patch: {
              finish: trimmed(data.finish) || "error",
              error: toServerError(data.error),
              cost: data.cost,
              tokens: wireTokens(data),
              retry: null,
              time: { completed: now },
            },
          }),
          wire,
        ),
      ]
    }

    case "session.retry.scheduled": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      if (!messageID) return []
      return [
        event(
          "message.patched",
          withDirectory({
            sessionID,
            messageID,
            patch: { retry: { attempt: data.attempt, at: data.at, error: data.error } },
          }),
          wire,
        ),
      ]
    }

    // --- text and reasoning ---------------------------------------------------

    case "session.text.started":
    case "session.reasoning.started": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0
      if (!messageID) return []
      const id = type === "session.text.started" ? partIds.text(messageID, ordinal) : partIds.reasoning(messageID, ordinal)
      return [
        partEvent(
          sessionID,
          partBase(sessionID, messageID, id, { type: type === "session.text.started" ? "text" : "reasoning", text: "", time: { start: now } }),
          wire,
        ),
      ]
    }

    case "session.text.delta":
    case "session.reasoning.delta": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0
      if (!messageID || typeof data.delta !== "string") return []
      return [
        event(
          "message.part.delta",
          {
            sessionID,
            messageID,
            partID: type === "session.text.delta" ? partIds.text(messageID, ordinal) : partIds.reasoning(messageID, ordinal),
            field: "text",
            delta: data.delta,
          },
          wire,
        ),
      ]
    }

    case "session.text.ended":
    case "session.reasoning.ended": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const ordinal = typeof data.ordinal === "number" ? data.ordinal : 0
      if (!messageID) return []
      const id = type === "session.text.ended" ? partIds.text(messageID, ordinal) : partIds.reasoning(messageID, ordinal)
      return [
        partEvent(
          sessionID,
          partBase(sessionID, messageID, id, {
            type: type === "session.text.ended" ? "text" : "reasoning",
            text: typeof data.text === "string" ? data.text : "",
            time: { start: now, end: now },
          }),
          wire,
        ),
      ]
    }

    // --- tool calls -----------------------------------------------------------

    case "session.tool.input.started": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      return [
        partEvent(
          sessionID,
          partBase(sessionID, messageID, partIds.tool(callID), {
            type: "tool",
            callID,
            tool: trimmed(data.name) || "tool",
            state: { status: "pending", input: {}, raw: "" },
          }),
          wire,
        ),
      ]
    }

    case "session.tool.input.delta": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID || typeof data.delta !== "string") return []
      return [
        event("message.part.delta", { sessionID, messageID, partID: partIds.tool(callID), field: "raw", delta: data.delta }, wire),
      ]
    }

    case "session.tool.input.ended": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      return [
        event(
          "message.tool.transition",
          { sessionID, messageID, partID: partIds.tool(callID), transition: { kind: "input", raw: typeof data.text === "string" ? data.text : "" } },
          wire,
        ),
      ]
    }

    case "session.tool.called": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      return [
        event(
          "message.tool.transition",
          {
            sessionID,
            messageID,
            partID: partIds.tool(callID),
            transition: {
              kind: "called",
              input: isRecord(data.input) ? data.input : {},
              executed: data.executed === true,
              start: now,
            },
          },
          wire,
        ),
      ]
    }

    case "session.tool.progress": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      return [
        event(
          "message.tool.transition",
          { sessionID, messageID, partID: partIds.tool(callID), transition: { kind: "progress", metadata: isRecord(data.metadata) ? data.metadata : undefined } },
          wire,
        ),
      ]
    }

    case "session.tool.success": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      return [
        event(
          "message.tool.transition",
          {
            sessionID,
            messageID,
            partID: partIds.tool(callID),
            transition: compact({
              kind: "success",
              output: toolOutputText(asToolContent(data.content)),
              attachments: toolAttachments(asToolContent(data.content), { sessionID, messageID, callID }),
              metadata: isRecord(data.metadata) ? data.metadata : undefined,
              executed: data.executed === true,
              end: now,
            }),
          },
          wire,
        ),
      ]
    }

    case "session.tool.failed": {
      if (!sessionID) return []
      const messageID = wireMessageId(data)
      const callID = trimmed(data.id)
      if (!messageID || !callID) return []
      const output = toolOutputText(asToolContent(data.content))
      return [
        event(
          "message.tool.transition",
          {
            sessionID,
            messageID,
            partID: partIds.tool(callID),
            transition: compact({
              kind: "failed",
              error: structuredErrorText(asStructuredError(data.error)),
              output: output || undefined,
              metadata: isRecord(data.metadata) ? data.metadata : undefined,
              executed: data.executed === true,
              end: now,
            }),
          },
          wire,
        ),
      ]
    }

    // --- plumbing notices, shells, compactions --------------------------------
    // The fork message store is user/assistant-shaped, so these ride the
    // adjacent `message.record` channel (`State.nativeRecords`) instead of
    // entering it. Record ids derive from the announcing event id (upstream's
    // `messageIdFromEvent`).

    case "session.synthetic": {
      if (!sessionID) return []
      return [recordEvent(sessionID, {
        id: messageIdFromWireEvent(wire),
        role: "synthetic",
        time: { created: now },
        text: typeof data.text === "string" ? data.text : "",
        description: typeof data.description === "string" ? data.description : undefined,
      }, wire)]
    }

    case "session.skill.activated": {
      if (!sessionID) return []
      return [recordEvent(sessionID, {
        id: messageIdFromWireEvent(wire),
        role: "skill",
        time: { created: now },
        skill: trimmed(data.id) || undefined,
        name: typeof data.name === "string" ? data.name : undefined,
        text: typeof data.text === "string" ? data.text : undefined,
      }, wire)]
    }

    case "session.instructions.updated": {
      if (!sessionID || data.text === undefined) return []
      return [recordEvent(sessionID, {
        id: messageIdFromWireEvent(wire),
        role: "system",
        time: { created: now },
        text: typeof data.text === "string" ? data.text : "",
        description: isRecord(data.delta) ? `Instructions updated: ${Object.keys(data.delta).join(", ")}` : undefined,
      }, wire)]
    }

    case "session.shell.started": {
      if (!sessionID) return []
      const shell = isRecord(data.shell) ? data.shell : null
      if (!shell) return []
      return [recordEvent(sessionID, {
        id: messageIdFromWireEvent(wire),
        role: "shell",
        time: { created: now },
        shellID: trimmed(shell.id) || undefined,
        command: typeof shell.command === "string" ? shell.command : "",
        status: typeof shell.status === "string" ? shell.status : undefined,
        exit: finiteExit(shell.exit),
      }, wire)]
    }

    case "session.shell.ended": {
      if (!sessionID) return []
      const shell = isRecord(data.shell) ? data.shell : null
      if (!shell) return []
      return [recordEvent(sessionID, {
        // The started event carried the record's id; the ended event names
        // only the shell, so the reducer matches by shellID.
        id: `shell:${trimmed(shell.id)}`,
        role: "shell",
        time: { created: now, completed: now },
        shellID: trimmed(shell.id) || undefined,
        status: typeof shell.status === "string" ? shell.status : undefined,
        exit: finiteExit(shell.exit),
        output: typeof data.output === "string" ? data.output : undefined,
      }, wire)]
    }

    case "session.compaction.started": {
      if (!sessionID) return []
      return [recordEvent(sessionID, {
        id: typeof data.inputID === "string" && data.inputID ? data.inputID : messageIdFromWireEvent(wire),
        role: "compaction",
        time: { created: now },
        compactionStatus: "running",
        reason: typeof data.reason === "string" ? data.reason : undefined,
        summary: "",
      }, wire)]
    }

    // The summary streams into the running compaction record; the event names
    // only the session, so the reducer finds that record itself.
    case "session.compaction.delta": {
      if (!sessionID || typeof data.text !== "string") return []
      return [event("message.record.delta", { sessionID, delta: data.text }, wire)]
    }

    case "session.compaction.ended":
    case "session.compaction.failed": {
      if (!sessionID) return []
      const failed = type === "session.compaction.failed"
      return [recordEvent(sessionID, {
        id: typeof data.inputID === "string" && data.inputID ? data.inputID : messageIdFromWireEvent(wire),
        role: "compaction",
        time: { created: now, completed: now },
        compactionStatus: failed ? "failed" : "completed",
        reason: typeof data.reason === "string" ? data.reason : undefined,
        summary: failed ? "" : typeof data.text === "string" ? data.text : "",
        error: failed ? data.error : undefined,
        cost: typeof data.cost === "number" ? data.cost : undefined,
      }, wire)]
    }

    // --- requests to the user -------------------------------------------------

    case "permission.asked": {
      const requestID = trimmed(data.id)
      if (!requestID || !sessionID) return []
      return [event("permission.asked", withDirectory(normalizePermissionProperties(data)), wire)]
    }

    case "permission.replied":
      if (!sessionID) return []
      return [event("permission.replied", withDirectory({ sessionID, requestID: trimmed(data.requestID) }), wire)]

    case "form.created": {
      const form = isRecord(data.form) ? data.form : null
      if (!form || !trimmed(form.id)) return []
      return [event("form.created", withDirectory({ sessionID: trimmed(form.sessionID), form }), wire)]
    }

    case "form.replied":
    case "form.cancelled":
      if (!sessionID) return []
      return [event("form.settled", withDirectory({ sessionID, formID: trimmed(data.id) }), wire)]

    // --- location-level notices and catalog -------------------------------------

    case "vcs.branch.updated":
      return [event("vcs.branch.updated", { branch: typeof data.branch === "string" ? data.branch : undefined }, wire)]

    case "mcp.status.changed":
      return [event("mcp.status.changed", { server: trimmed(data.server) }, wire)]

    // 2.0.8 replaced the `catalog.updated` storm with deduplicated
    // announcements; the fork-adjacent carrier drives the rate-limited store
    // re-reads (catalogRefresh) from sync-context.
    case "config.updated":
      return [event("catalog.updated", { kind: "config" }, wire)]
    case "agent.updated":
      return [event("catalog.updated", { kind: "agent" }, wire)]
    case "command.updated":
      return [event("catalog.updated", { kind: "command" }, wire)]
    case "skill.updated":
      return [event("catalog.updated", { kind: "skill" }, wire)]
    case "plugin.updated":
      return [event("catalog.updated", { kind: "plugin" }, wire)]
    case "credential.updated":
    case "credential.switched":
      return [event("catalog.updated", { kind: "credential" }, wire)]
    case "project.updated":
      return [event("catalog.updated", { kind: "project" }, wire)]
    case "provider.updated":
      return [event("catalog.updated", { kind: "provider" }, wire)]
    case "model.updated":
      return [event("catalog.updated", { kind: "model" }, wire)]

    default:
      return []
  }
}

/**
 * True when a payload is a raw v2 wire frame (`{type, data}` — no fork
 * `properties` envelope). Intake translates these even when the server's
 * protocol mode was never recorded in the UI mode registry, so an unrecorded
 * v2 server still feeds the reducer translated events instead of raw frames.
 */
export function looksLikeRawV2WireEvent(payload: unknown): boolean {
  if (!isRecord(payload)) return false
  if (typeof payload.type !== "string" || payload.type.length === 0) return false
  if ("properties" in payload) return false
  return "data" in payload || "location" in payload || "created" in payload
}

/** True when a raw payload is an OpenChamber server frame, not OpenCode wire. */
export function isOpenchamberFrame(payload: unknown): boolean {
  return isRecord(payload) && typeof payload.type === "string" && payload.type.startsWith("openchamber:")
}
