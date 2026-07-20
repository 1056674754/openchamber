// ---------------------------------------------------------------------------
// Payload sanitization — bound oversized history fields retained client-side.
//
// OpenCode session/message snapshots may carry large full-content diff fields
// (legacy before/after or from/to). The UI never uses these fields but they
// waste browser memory and can crash tabs for large sessions.
//
// Also caps diff entries, individual patches, and completed tool payload fields
// to prevent pathological history records from remaining in browser memory.
//
// Applied at two points:
// 1. Event reducer — session.created/session.updated events
// 2. Message loading/materialization — session.messages responses
//
// This runs after HTTP JSON parsing. The OpenCode server must still enforce its
// own response byte budget to avoid upstream serialization and transport spikes.
// ---------------------------------------------------------------------------

import type { Message, Part, Session, ToolPart } from "@opencode-ai/sdk/v2/client"

export const INLINE_PART_PAYLOAD_CHAR_LIMIT = 1_000_000
export const OPENCHAMBER_TRUNCATION_METADATA_KEY = "__openchamberTruncated"

type SanitizedRecord = {
  readonly value: Record<string, unknown>
  readonly truncated: boolean
}

function exceedsInlinePartBudget(value: unknown): boolean {
  let remaining = INLINE_PART_PAYLOAD_CHAR_LIMIT
  const pending: unknown[] = [value]
  const seen = new WeakSet<object>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || current === undefined) continue

    if (typeof current === "string") {
      remaining -= current.length + 2
    } else if (typeof current === "object") {
      if (seen.has(current)) return true
      seen.add(current)

      if (Array.isArray(current)) {
        remaining -= current.length + 1
        for (let index = current.length - 1; index >= 0; index -= 1) {
          pending.push(current[index])
        }
      } else {
        remaining -= 2
        for (const [key, child] of Object.entries(current)) {
          remaining -= key.length + 4
          pending.push(child)
        }
      }
    } else {
      remaining -= 16
    }

    if (remaining < 0) return true
  }

  return false
}

function sanitizeRecord(value: Record<string, unknown>): SanitizedRecord {
  if (!exceedsInlinePartBudget(value)) {
    return { value, truncated: false }
  }
  return { value: {}, truncated: true }
}

function sanitizeToolPart(part: ToolPart): ToolPart {
  const truncatedFields: string[] = []
  const input = sanitizeRecord(part.state.input)
  if (input.truncated) truncatedFields.push("state.input")

  let state: ToolPart["state"]
  switch (part.state.status) {
    case "pending": {
      const raw = part.state.raw.length > INLINE_PART_PAYLOAD_CHAR_LIMIT
        ? part.state.raw.slice(0, INLINE_PART_PAYLOAD_CHAR_LIMIT)
        : part.state.raw
      if (raw !== part.state.raw) truncatedFields.push("state.raw")
      state = { ...part.state, input: input.value, raw }
      break
    }
    case "running": {
      const metadata = sanitizeRecord(part.state.metadata ?? {})
      if (metadata.truncated) truncatedFields.push("state.metadata")
      state = { ...part.state, input: input.value, metadata: metadata.value }
      break
    }
    case "completed": {
      const output = part.state.output.length > INLINE_PART_PAYLOAD_CHAR_LIMIT
        ? part.state.output.slice(0, INLINE_PART_PAYLOAD_CHAR_LIMIT)
        : part.state.output
      const metadata = sanitizeRecord(part.state.metadata)
      if (output !== part.state.output) truncatedFields.push("state.output")
      if (metadata.truncated) truncatedFields.push("state.metadata")
      state = { ...part.state, input: input.value, output, metadata: metadata.value }
      break
    }
    case "error": {
      const error = part.state.error.length > INLINE_PART_PAYLOAD_CHAR_LIMIT
        ? part.state.error.slice(0, INLINE_PART_PAYLOAD_CHAR_LIMIT)
        : part.state.error
      const metadata = sanitizeRecord(part.state.metadata ?? {})
      if (error !== part.state.error) truncatedFields.push("state.error")
      if (metadata.truncated) truncatedFields.push("state.metadata")
      state = { ...part.state, input: input.value, error, metadata: metadata.value }
      break
    }
  }

  const partMetadata = sanitizeRecord(part.metadata ?? {})
  if (partMetadata.truncated) truncatedFields.push("metadata")
  if (truncatedFields.length === 0) return part

  return {
    ...part,
    state,
    metadata: {
      ...partMetadata.value,
      [OPENCHAMBER_TRUNCATION_METADATA_KEY]: {
        fields: truncatedFields,
        limit: INLINE_PART_PAYLOAD_CHAR_LIMIT,
      },
    },
  }
}

export function sanitizePartPayload(part: Part): Part {
  if (part.type !== "tool") return part
  return sanitizeToolPart(part)
}

/** Maximum number of diff entries we keep in memory. */
const MAX_DIFF_ENTRIES = 500

/** Maximum size (chars) for an individual patch field. */
const MAX_PATCH_SIZE = 100_000

type DiffEntry = {
  file?: string
  patch?: string
  status?: string
  additions?: number
  deletions?: number
  before?: string
  after?: string
  from?: string
  to?: string
}

type SessionSummary = {
  diffs?: DiffEntry[]
  _truncated?: string
  [key: string]: unknown
}

function sanitizeDiffs(diffs: DiffEntry[]): { diffs: DiffEntry[]; changed: boolean; truncatedCount?: number } {
  const needsTruncation = diffs.length > MAX_DIFF_ENTRIES
  const capped = needsTruncation ? diffs.slice(0, MAX_DIFF_ENTRIES) : diffs

  let fieldChanged = false
  const stripped = capped.map((d) => {
    if (!d) return d

    let needsClone = false

    if (typeof d.before === "string" || typeof d.after === "string"
      || typeof d.from === "string" || typeof d.to === "string") {
      needsClone = true
    }

    if (typeof d.patch === "string" && d.patch.length > MAX_PATCH_SIZE) {
      needsClone = true
    }

    if (!needsClone) return d

    fieldChanged = true
    const rest = { ...d }
    delete rest.before
    delete rest.after
    delete rest.from
    delete rest.to
    if (typeof rest.patch === "string" && rest.patch.length > MAX_PATCH_SIZE) {
      rest.patch = rest.patch.slice(0, MAX_PATCH_SIZE)
    }
    return rest
  })

  const changed = fieldChanged || needsTruncation
  return {
    diffs: stripped,
    changed,
    truncatedCount: needsTruncation ? diffs.length : undefined,
  }
}

export function stripSessionDiffSnapshots(session: Session): Session {
  const summary = (session as { summary?: SessionSummary }).summary
  if (!summary?.diffs || !Array.isArray(summary.diffs)) return session

  const result = sanitizeDiffs(summary.diffs)
  if (!result.changed) return session

  const nextSummary: SessionSummary = { ...summary, diffs: result.diffs }
  if (result.truncatedCount) {
    nextSummary._truncated = `${result.truncatedCount} diffs capped to ${MAX_DIFF_ENTRIES}`
  }
  return { ...session, summary: nextSummary } as Session
}

export function stripMessageDiffSnapshots(message: Message): Message {
  const summary = (message as { summary?: SessionSummary }).summary
  if (!summary?.diffs || !Array.isArray(summary.diffs)) return message

  const result = sanitizeDiffs(summary.diffs)
  if (!result.changed) return message

  const nextSummary: SessionSummary = { ...summary, diffs: result.diffs }
  if (result.truncatedCount) {
    nextSummary._truncated = `${result.truncatedCount} diffs capped to ${MAX_DIFF_ENTRIES}`
  }
  return { ...message, summary: nextSummary } as Message
}
