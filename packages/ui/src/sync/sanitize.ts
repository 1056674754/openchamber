// ---------------------------------------------------------------------------
// Payload sanitization — strip oversized diff snapshot fields client-side.
//
// OpenCode session/message snapshots may carry large full-content diff fields
// (legacy before/after or from/to). The UI never uses these fields but they
// waste browser memory and can crash tabs for large sessions.
//
// Also caps the number of diff entries and individual patch sizes to prevent
// OOM from pathological cases (e.g. an agent committing node_modules or
// .pnpm-store producing 40K+ diff entries / 200MB+ payloads).
//
// Applied at two points:
// 1. Event reducer — session.created/session.updated events
// 2. Message loading — fetchMessages response
// ---------------------------------------------------------------------------

import type { Session, Message } from "@opencode-ai/sdk/v2/client"

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
