import type {
  Event,
  Message,
  Part,
  PermissionRequest,
  Project,
  Session,
  SessionStatus,
  Todo,
} from "@opencode-ai/sdk/v2/client"
import type { FormRequest } from "@/types/form"
import { Binary } from "./binary"
import type { DirectoryEventFrame, FileDiff, GlobalState, State } from "./types"
import { dropSessionCaches } from "./session-cache"
import { stripSessionDiffSnapshots } from "./sanitize"
import { syncDebug } from "./debug"
import { shouldSkipStaleSessionEvent } from "./session-event-freshness"
import { useSessionMarkersStore } from "@/stores/useSessionMarkersStore"
import { compareMessagesChronologically, findMessageIndex, insertMessageChronologically } from './message-ordering'

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])
const DELTA_OVERLAP_FIELDS = ["text", "output"] as const
const FINAL_TOOL_STATUSES = new Set(["completed", "error", "aborted", "failed", "timeout", "cancelled"])

type DedupeMetadata = {
  __dedupeNextDeltaFields?: string[]
}

function appendNonOverlappingDelta(existingValue: string | undefined, delta: string) {
  if (!existingValue || delta.length === 0) return (existingValue ?? "") + delta
  if (existingValue.endsWith(delta)) return existingValue

  const maxOverlap = Math.min(existingValue.length, delta.length)
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (existingValue.endsWith(delta.slice(0, overlap))) {
      return existingValue + delta.slice(overlap)
    }
  }

  return existingValue + delta
}

function getUpdatedDeltaFields(previous: Part, next: Part) {
  const dedupeFields: string[] = []
  for (const field of DELTA_OVERLAP_FIELDS) {
    const previousValue = (previous as Record<string, unknown>)[field]
    const nextValue = (next as Record<string, unknown>)[field]
    if (typeof previousValue !== "string" || typeof nextValue !== "string") continue
    if (previousValue.length === 0 || nextValue.length === 0) continue
    if (nextValue === previousValue || nextValue.startsWith(previousValue) || previousValue.startsWith(nextValue)) {
      dedupeFields.push(field)
    }
  }
  return dedupeFields
}

function getPartEndTime(part: Part): number | undefined {
  const stateEnd = (part as { state?: { time?: { end?: unknown } } }).state?.time?.end
  if (typeof stateEnd === "number") {
    return stateEnd
  }

  const timeEnd = (part as { time?: { end?: unknown } }).time?.end
  return typeof timeEnd === "number" ? timeEnd : undefined
}

function getToolStatus(part: Part): string | undefined {
  if (part.type !== "tool") {
    return undefined
  }

  const status = (part as { state?: { status?: unknown } }).state?.status
  return typeof status === "string" ? status : undefined
}

function shouldPreserveExistingPart(previous: Part, next: Part): boolean {
  if (previous.type !== "tool" || next.type !== "tool") {
    return false
  }

  const previousStatus = getToolStatus(previous)
  const nextStatus = getToolStatus(next)
  if (previousStatus && FINAL_TOOL_STATUSES.has(previousStatus) && (!nextStatus || !FINAL_TOOL_STATUSES.has(nextStatus))) {
    return true
  }

  const previousEnd = getPartEndTime(previous)
  const nextEnd = getPartEndTime(next)
  if (typeof previousEnd === "number" && typeof nextEnd !== "number") {
    return true
  }

  return false
}

function areSessionStatusesEqual(left: SessionStatus | undefined, right: SessionStatus): boolean {
  if (left === right) return true
  if (!left || left.type !== right.type) return false
  if (left.type === "retry") {
    return right.type === "retry"
      && left.attempt === right.attempt
      && left.message === right.message
      && left.next === right.next
  }
  return true
}

function areJsonEquivalent(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return left === right
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function areMessageUpdateFieldsEqual(existing: Message, next: Message): boolean {
  if (existing.role !== next.role) return false
  if ((existing as { finish?: unknown }).finish !== (next as { finish?: unknown }).finish) return false
  if ((existing.time as { completed?: number })?.completed !== (next.time as { completed?: number })?.completed) return false

  const fields: Array<keyof Message | "structured" | "summary" | "tokens" | "error" | "cost" | "model" | "tools" | "format" | "variant" | "agent" | "system"> = [
    "summary",
    "error",
    "cost",
    "tokens",
    "structured",
    "model",
    "tools",
    "format",
    "variant",
    "agent",
    "system",
  ]

  for (const field of fields) {
    if (!areJsonEquivalent((existing as Record<string, unknown>)[field], (next as Record<string, unknown>)[field])) {
      return false
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Global events
// ---------------------------------------------------------------------------

export type GlobalEventResult = {
  type: "refresh"
} | {
  type: "project"
  project: Project
} | null

export type DirectoryEventResult = boolean | {
  changed: boolean
  materialization: {
    type: "incomplete-session-snapshot"
    sessionID?: string
    messageID: string
    partID?: string
  }
}

function hasMessage(draft: State, sessionID: string | undefined, messageID: string): boolean {
  if (!sessionID) return false
  const messages = draft.message[sessionID]
  if (!messages) return false
  return messages.some((message) => message.id === messageID)
}

export function reduceGlobalEvent(event: Event): GlobalEventResult {
  if (event.type === "global.disposed" || event.type === "server.connected") {
    return { type: "refresh" }
  }
  if (event.type === "project.updated") {
    return { type: "project", project: event.properties as Project }
  }
  return null
}

export function applyGlobalProject(state: GlobalState, project: Project): GlobalState {
  const projects = [...state.projects]
  const result = Binary.search(projects, project.id, (s) => s.id)
  if (result.found) {
    projects[result.index] = { ...projects[result.index], ...project }
  } else {
    projects.splice(result.index, 0, project)
  }
  return { ...state, projects }
}

// ---------------------------------------------------------------------------
// Directory events — mutates draft in place for batching efficiency.
// Caller MUST pass a mutable copy of State (e.g. structuredClone or spread).
// ---------------------------------------------------------------------------

export function applyDirectoryEvent(
  draft: State,
  event: DirectoryEventFrame,
  callbacks?: {
    onRefresh?: (directory: string) => void
    onLoadLsp?: () => void
    onSetSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
    isSessionDeleting?: (sessionID: string) => boolean
  },
): DirectoryEventResult {
  switch (event.type) {
    case "server.instance.disposed": {
      callbacks?.onRefresh?.("")
      return false
    }

    case "session.created": {
      const info = stripSessionDiffSnapshots((event.properties as { info: Session }).info)
      const sessions = draft.session
      const result = Binary.search(sessions, info.id, (s) => s.id)
      if (result.found && shouldSkipStaleSessionEvent(sessions[result.index], info)) {
        return false
      }
      if (result.found) {
        sessions[result.index] = info
      } else {
        sessions.splice(result.index, 0, info)
        trimSessions(draft)
        if (!info.parentID) draft.sessionTotal += 1
      }
      return true
    }

    case "session.updated": {
      const info = stripSessionDiffSnapshots((event.properties as { info: Session }).info)
      const sessions = draft.session
      const result = Binary.search(sessions, info.id, (s) => s.id)

      if (result.found && shouldSkipStaleSessionEvent(sessions[result.index], info)) {
        return false
      }

      if (info.time.archived) {
        if (callbacks?.isSessionDeleting?.(info.id)) return false
        if (result.found) sessions.splice(result.index, 1)
        cleanupSessionCaches(draft, info.id, callbacks?.onSetSessionTodo)
        if (!info.parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
        return true
      }

      if (result.found) {
        sessions[result.index] = info
        return true
      }

      // Don't re-insert: prevents deleted sessions from being restored by
      // out-of-order SSE events (flicker bug).
      return false
    }

    case "session.deleted": {
      const props = event.properties as { info?: Session; sessionID?: string }
      const sessionID = props.info?.id ?? props.sessionID
      if (!sessionID) return false
      if (callbacks?.isSessionDeleting?.(sessionID)) return false
      const sessions = draft.session
      const result = Binary.search(sessions, sessionID, (s) => s.id)
      const existing = result.found ? sessions[result.index] : undefined
      if (result.found) sessions.splice(result.index, 1)
      cleanupSessionCaches(draft, sessionID, callbacks?.onSetSessionTodo)
      useSessionMarkersStore.getState().clearAllForSession(sessionID)
      const parentID = props.info?.parentID ?? (existing as Session & { parentID?: string | null } | undefined)?.parentID
      if (result.found && !parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
      return true
    }

    case "session.diff": {
      const props = event.properties as { sessionID: string; diff: FileDiff[] }
      draft.session_diff[props.sessionID] = props.diff
      return true
    }

    case "todo.updated": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      draft.todo[props.sessionID] = props.todos
      callbacks?.onSetSessionTodo?.(props.sessionID, props.todos)
      return true
    }

    case "session.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], props.status)) {
        return false
      }
      draft.session_status[props.sessionID] = props.status
      if (props.status.type === "idle") {
        delete draft.session_activity[props.sessionID]
      }
      return true
    }

    case "session.idle": {
      const props = event.properties as { sessionID: string }
      const status = { type: "idle" } as const
      delete draft.session_activity[props.sessionID]
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], status)) {
        return false
      }
      draft.session_status[props.sessionID] = status
      return true
    }

    case "session.error": {
      const props = event.properties as { sessionID: string }
      const status = { type: "idle" } as const
      delete draft.session_activity[props.sessionID]
      if (areSessionStatusesEqual(draft.session_status[props.sessionID], status)) {
        return false
      }
      draft.session_status[props.sessionID] = status
      return true
    }

    case "message.updated": {
      const info = (event.properties as { info: Message }).info
      const messages = draft.message[info.sessionID]
      if (!messages) {
        draft.message[info.sessionID] = [info]
        return true
      }
      const messageIndex = findMessageIndex(messages, info.id)
      if (messageIndex >= 0) {
        // Skip message replacement if unchanged — preserves reference, avoids re-render
        const existing = messages[messageIndex]
        const unchanged = areMessageUpdateFieldsEqual(existing, info)
        if (unchanged) {
          syncDebug.reducer.messageUpdatedUnchanged(info.sessionID, info.id, info.role, (info as { finish?: unknown }).finish, (info.time as { completed?: number })?.completed)
          return false
        }
        const next = [...messages]
        if (compareMessagesChronologically(existing, info) === 0) {
          next[messageIndex] = info
        } else {
          next.splice(messageIndex, 1)
          insertMessageChronologically(next, info)
        }
        draft.message[info.sessionID] = next
      } else {
        const next = [...messages]
        insertMessageChronologically(next, info)
        draft.message[info.sessionID] = next
      }
      return true
    }

    case "message.removed": {
      const props = event.properties as { sessionID: string; messageID: string }
      const messages = draft.message[props.sessionID]
      let changed = false
      if (messages) {
        const next = [...messages]
        const messageIndex = findMessageIndex(next, props.messageID)
        if (messageIndex >= 0) {
          next.splice(messageIndex, 1)
          draft.message[props.sessionID] = next
          changed = true
        }
      }
      if (Object.prototype.hasOwnProperty.call(draft.part, props.messageID)) {
        delete draft.part[props.messageID]
        changed = true
      }
      return changed
    }

    case "message.part.updated": {
      const props = event.properties as { sessionID?: string; part: Part }
      const part = props.part
      if (SKIP_PARTS.has(part.type)) {
        syncDebug.reducer.partSkipped((part as { messageID: string }).messageID, part.id, part.type)
        return false
      }
      const messageID = (part as { messageID?: string }).messageID
      const sessionID = props.sessionID ?? (part as { sessionID?: string }).sessionID
      if (!messageID) return false
      if (sessionID) {
        draft.session_activity[sessionID] = Date.now()
      }
      const missingOwningMessage = !hasMessage(draft, sessionID, messageID)
      const parts = draft.part[messageID]
      if (!parts) {
        syncDebug.reducer.partUpdatedNoExistingParts(messageID, part.id, part.type)
        draft.part[messageID] = [part]
        return missingOwningMessage
          ? {
            changed: true,
            materialization: { type: "incomplete-session-snapshot", sessionID, messageID, partID: part.id },
          }
          : true
      }
      const next = [...parts]
      const partIndex = next.findIndex((candidate) => candidate.id === part.id)
      if (partIndex >= 0) {
        const previous = next[partIndex]
        if (shouldPreserveExistingPart(previous, part)) {
          return false
        }
        const dedupeFields = getUpdatedDeltaFields(previous, part)
        next[partIndex] = dedupeFields.length > 0
          ? { ...part, __dedupeNextDeltaFields: dedupeFields } as unknown as Part
          : part
      } else {
        // Replace optimistic part (no sessionID) with server part of same type.
        // Gate: only scan if the first part lacks sessionID (optimistic parts are
        // always inserted first). Assistant messages never have optimistic parts,
        // so this check is effectively free during streaming.
        const hasOptimistic = next.length > 0 && !(next[0] as { sessionID?: string }).sessionID
        const optimisticIdx = hasOptimistic && (part.type === "text" || part.type === "file")
          ? next.findIndex((p) => p.type === part.type && !(p as { sessionID?: string }).sessionID)
          : -1
        if (optimisticIdx >= 0) {
          next.splice(optimisticIdx, 1)
        }
        next.push(part)
      }
      draft.part[messageID] = next
      return missingOwningMessage
        ? {
          changed: true,
          materialization: { type: "incomplete-session-snapshot", sessionID, messageID, partID: part.id },
        }
        : true
    }

    case "message.part.removed": {
      const props = event.properties as { messageID: string; partID: string }
      const parts = draft.part[props.messageID]
      if (!parts) return false
      const partIndex = parts.findIndex((part) => part.id === props.partID)
      if (partIndex >= 0) {
        const next = [...parts]
        next.splice(partIndex, 1)
        if (next.length === 0) {
          delete draft.part[props.messageID]
        } else {
          draft.part[props.messageID] = next
        }
        return true
      }
      return false
    }

    case "message.part.delta": {
      const props = event.properties as {
        sessionID?: string
        messageID: string
        partID: string
        field: string
        delta: string
      }
      const parts = draft.part[props.messageID]
      if (!parts) {
        syncDebug.reducer.partDeltaNoParts(props.messageID, props.partID)
        return {
          changed: false,
          materialization: { type: "incomplete-session-snapshot", sessionID: props.sessionID, messageID: props.messageID, partID: props.partID },
        }
      }
      const partIndex = parts.findIndex((part) => part.id === props.partID)
      if (partIndex < 0) {
        syncDebug.reducer.partDeltaNotFound(props.messageID, props.partID)
        return {
          changed: false,
          materialization: { type: "incomplete-session-snapshot", sessionID: props.sessionID, messageID: props.messageID, partID: props.partID },
        }
      }
      const existing = parts[partIndex] as Record<string, unknown>
      const existingValue = existing[props.field] as string | undefined
      const dedupeFields = (existing as DedupeMetadata).__dedupeNextDeltaFields ?? []
      const shouldDedupe = dedupeFields.includes(props.field)
      const sessionID = props.sessionID ?? (existing as { sessionID?: string }).sessionID
      if (sessionID) {
        draft.session_activity[sessionID] = Date.now()
      }
      // Create new Part object + new array so React detects the change
      const next = [...parts]
      next[partIndex] = {
        ...existing,
        [props.field]: shouldDedupe ? appendNonOverlappingDelta(existingValue, props.delta) : (existingValue ?? "") + props.delta,
        __dedupeNextDeltaFields: dedupeFields.filter((field) => field !== props.field),
      } as unknown as Part
      draft.part[props.messageID] = next
      return true
    }

    case "vcs.branch.updated": {
      const props = event.properties as { branch: string }
      if (draft.vcs?.branch === props.branch) return false
      draft.vcs = { branch: props.branch }
      return true
    }

    case "permission.asked": {
      const permission = event.properties as PermissionRequest
      const permissions = draft.permission[permission.sessionID] ?? []
      const next = [...permissions]
      const result = Binary.search(next, permission.id, (p) => p.id)
      if (result.found) {
        next[result.index] = permission
      } else {
        next.splice(result.index, 0, permission)
      }
      draft.permission[permission.sessionID] = next
      return true
    }

    case "permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      const permissions = draft.permission[props.sessionID]
      if (!permissions) return false
      const result = Binary.search(permissions, props.requestID, (p) => p.id)
      if (result.found) {
        const next = [...permissions]
        next.splice(result.index, 1)
        draft.permission[props.sessionID] = next
        return true
      }
      return false
    }

    // v1 wire keeps the `question.*` names; the store field is the form
    // concept (spine S7 rename — runtime behavior unchanged).
    case "question.asked": {
      const form = event.properties as FormRequest
      const forms = draft.form[form.sessionID] ?? []
      const next = [...forms]
      const result = Binary.search(next, form.id, (f) => f.id)
      if (result.found) {
        next[result.index] = form
      } else {
        next.splice(result.index, 0, form)
      }
      draft.form[form.sessionID] = next
      return true
    }

    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      const forms = draft.form[props.sessionID]
      if (!forms) return false
      const result = Binary.search(forms, props.requestID, (f) => f.id)
      if (result.found) {
        const next = [...forms]
        next.splice(result.index, 1)
        draft.form[props.sessionID] = next
        return true
      }
      return false
    }

    // v2 track: the server translates OpenCode 2.x `session.form.*` events
    // (translate-v2) into these frames. They only arrive from a v2 instance,
    // so the v1 track never reaches these branches. The v2-native shape rides
    // the adjacent `nativeForm` channel; the v2 dock consumes it from there.
    case "form.created": {
      const { sessionID, form } = event.properties
      if (!form.id || !sessionID) return false
      const forms = draft.nativeForm[sessionID] ?? []
      const next = [...forms]
      const result = Binary.search(next, form.id, (f) => f.id)
      if (result.found) {
        next[result.index] = form
      } else {
        next.splice(result.index, 0, form)
      }
      draft.nativeForm[sessionID] = next
      return true
    }

    case "form.settled": {
      const { sessionID, formID } = event.properties
      if (!sessionID || !formID) return false
      const forms = draft.nativeForm[sessionID]
      if (!forms) return false
      const result = Binary.search(forms, formID, (f) => f.id)
      if (result.found) {
        const next = [...forms]
        next.splice(result.index, 1)
        draft.nativeForm[sessionID] = next
        return true
      }
      return false
    }

    case "lsp.updated": {
      callbacks?.onLoadLsp?.()
      return false
    }

    // --- v2 bridge events (OC2 spine S6) -------------------------------------
    // These event names are produced only by the wire bridge
    // (`lib/opencode/wire-bridge.ts`) for servers whose protocol mode is v2.
    // The v1 wire never emits them, so the v1 track can never reach these
    // branches — same contract as the `form.*` cases above.

    case "session.patched": {
      // v2 patches fields; v1 replaced whole records. Merge into the stored
      // session so a partial rename/usage/switch never clobbers the rest.
      const props = event.properties as {
        sessionID: string
        patch: {
          title?: string
          directory?: string
          projectID?: string
          agent?: string
          model?: { providerID: string; modelID: string; variant?: string }
          cost?: number
          tokens?: unknown
          permissions?: unknown
          revert?: Session["revert"] | null
          time?: { created?: number; updated?: number; idle?: number }
        }
      }
      if (!props.sessionID) return false
      const sessions = draft.session
      const result = Binary.search(sessions, props.sessionID, (s) => s.id)
      if (!result.found) {
        // Not loaded yet: the session list bootstrap (or a later
        // session.created) carries the full record; a patch alone cannot.
        return false
      }
      const existing = sessions[result.index]
      const patch = props.patch
      const nextTime = patch.time
        ? { ...existing.time, ...compactDefined(patch.time as Record<string, unknown>) }
        : existing.time
      const merged = {
        ...existing,
        ...compactDefined(patch as Record<string, unknown>),
        time: nextTime,
      } as Session
      if (existing === merged) return false
      if (shouldSkipStaleSessionEvent(existing, merged)) return false
      if (merged.time.archived && !existing.time.archived) {
        if (callbacks?.isSessionDeleting?.(merged.id)) return false
        sessions.splice(result.index, 1)
        cleanupSessionCaches(draft, merged.id, callbacks?.onSetSessionTodo)
        if (!merged.parentID) draft.sessionTotal = Math.max(0, draft.sessionTotal - 1)
        return true
      }
      sessions[result.index] = merged
      return true
    }

    case "message.patched": {
      // v2 step events patch assistant messages; the reducer merges into the
      // stored record, creating a minimal one when the step start beat the
      // message list fetch.
      const props = event.properties as {
        sessionID: string
        messageID: string
        patch: Record<string, unknown> & {
          time?: { created?: number; streamed?: number; completed?: number }
          retry?: unknown
        }
      }
      if (!props.sessionID || !props.messageID) return false
      const messages = draft.message[props.sessionID]
      const patch = props.patch
      const patchRole = patch.role
      if (!messages) {
        if (patchRole !== "assistant") return false
        draft.message[props.sessionID] = [createMinimalAssistantMessage(props.sessionID, props.messageID, patch)]
        return true
      }
      const messageIndex = findMessageIndex(messages, props.messageID)
      if (messageIndex < 0) {
        if (patchRole !== "assistant") return false
        const next = [...messages]
        insertMessageChronologically(next, createMinimalAssistantMessage(props.sessionID, props.messageID, patch))
        draft.message[props.sessionID] = next
        return true
      }
      const existing = messages[messageIndex]
      const patchTime = patch.time ?? undefined
      const mergedTime = patchTime ? { ...existing.time, ...compactDefined(patchTime as Record<string, unknown>) } : existing.time
      const merged = { ...existing, ...compactDefined(patch), time: mergedTime } as Record<string, unknown>
      // `retry: null` clears a scheduled retry; an object replaces it (spread
      // above already replaced it when set).
      if (patch.retry === null) delete merged.retry
      if (areJsonEquivalent(existing, merged)) return false
      const mergedMessage = merged as unknown as Message
      const next = [...messages]
      if (compareMessagesChronologically(existing, mergedMessage) === 0) {
        next[messageIndex] = mergedMessage
      } else {
        next.splice(messageIndex, 1)
        insertMessageChronologically(next, mergedMessage)
      }
      draft.message[props.sessionID] = next
      return true
    }

    case "message.tool.transition": {
      // v2 tool events carry the next state of one tool call, not a full part;
      // the reducer merges into the stored part's state. A transition for a
      // part the store never saw materializes the session (same contract as a
      // delta with no part).
      const props = event.properties as {
        sessionID?: string
        messageID: string
        partID: string
        transition: {
          kind: "input" | "called" | "progress" | "success" | "failed"
          raw?: string
          input?: Record<string, unknown>
          executed?: boolean
          start?: number
          end?: number
          output?: string
          error?: string
          attachments?: Part[]
          metadata?: Record<string, unknown>
        }
      }
      const parts = draft.part[props.messageID]
      if (!parts) {
        return {
          changed: false,
          materialization: {
            type: "incomplete-session-snapshot",
            sessionID: props.sessionID,
            messageID: props.messageID,
            partID: props.partID,
          },
        }
      }
      const partIndex = parts.findIndex((part) => part.id === props.partID)
      if (partIndex < 0) {
        return {
          changed: false,
          materialization: {
            type: "incomplete-session-snapshot",
            sessionID: props.sessionID,
            messageID: props.messageID,
            partID: props.partID,
          },
        }
      }
      const existing = parts[partIndex] as Record<string, unknown>
      const transition = props.transition
      const previousState = (existing.state ?? {}) as Record<string, unknown>
      const previousInput = (previousState.input ?? {}) as Record<string, unknown>
      const previousTime = (previousState.time ?? {}) as { start?: number; end?: number }
      const state: Record<string, unknown> = { ...previousState }
      switch (transition.kind) {
        case "input":
          state.status = "pending"
          state.raw = transition.raw ?? ""
          break
        case "called":
          state.status = "running"
          state.input = transition.input ?? previousInput
          state.time = { start: transition.start ?? previousTime.start ?? Date.now() }
          break
        case "progress":
          state.status = previousState.status === "pending" ? "running" : previousState.status ?? "running"
          if (transition.metadata) state.metadata = transition.metadata
          break
        case "success":
          state.status = "completed"
          state.input = transition.input ?? previousInput
          state.output = transition.output ?? ""
          state.title = typeof previousState.title === "string" ? previousState.title : ""
          state.metadata = transition.metadata ?? previousState.metadata ?? {}
          state.time = { start: previousTime.start ?? transition.end, end: transition.end }
          if (transition.attachments && transition.attachments.length > 0) state.attachments = transition.attachments
          break
        case "failed":
          state.status = "error"
          state.input = transition.input ?? previousInput
          state.error = transition.error ?? ""
          if (transition.output) state.output = transition.output
          if (transition.metadata) state.metadata = transition.metadata
          state.time = { start: previousTime.start ?? transition.end, end: transition.end }
          break
      }
      const next = [...parts]
      next[partIndex] = { ...existing, state } as unknown as Part
      draft.part[props.messageID] = next
      if (props.sessionID) {
        draft.session_activity[props.sessionID] = Date.now()
      }
      return true
    }

    default:
      return false
  }
}

/** Drops `undefined` values so a patch merge never clears a field it omitted. */
function compactDefined(source: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * A step patch may name an assistant message the store has not fetched yet
 * (late join). Store the fields the patch carries; the parts-gap recovery on
 * the next `message.updated` (or the session refetch) completes the record.
 */
function createMinimalAssistantMessage(
  sessionID: string,
  messageID: string,
  patch: Record<string, unknown> & { time?: { created?: number; streamed?: number; completed?: number } },
): Message {
  const created = typeof patch.time?.created === "number" ? patch.time.created : Date.now()
  const message: Record<string, unknown> = {
    id: messageID,
    sessionID,
    role: "assistant",
    parentID: sessionID,
    modelID: typeof patch.modelID === "string" ? patch.modelID : "",
    providerID: typeof patch.providerID === "string" ? patch.providerID : "",
    mode: "",
    agent: typeof patch.agent === "string" ? patch.agent : "",
    path: { cwd: "", root: "" },
    cost: typeof patch.cost === "number" ? patch.cost : 0,
    tokens: patch.tokens ?? { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created },
  }
  if (typeof patch.time?.streamed === "number") (message.time as Record<string, unknown>).streamed = patch.time.streamed
  if (typeof patch.time?.completed === "number") (message.time as Record<string, unknown>).completed = patch.time.completed
  if (patch.finish !== undefined) message.finish = patch.finish
  if (patch.error !== undefined) message.error = patch.error
  if (patch.variant !== undefined) message.variant = patch.variant
  if (patch.snapshot !== undefined) message.snapshot = patch.snapshot
  return message as unknown as Message
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trimSessions(draft: State) {
  if (draft.session.length <= draft.limit) return
  // Keep sessions that have pending permissions (they need to stay visible)
  const hasPermission = new Set(
    Object.entries(draft.permission ?? {})
      .filter(([, perms]) => perms && perms.length > 0)
      .map(([sessionID]) => sessionID),
  )
  while (draft.session.length > draft.limit) {
    let oldestIndex = -1
    let oldestUpdatedAt = Number.POSITIVE_INFINITY
    for (const [index, session] of draft.session.entries()) {
      if (hasPermission.has(session.id)) continue
      const updatedAt = session.time.updated ?? session.time.created
      if (updatedAt >= oldestUpdatedAt) continue
      oldestIndex = index
      oldestUpdatedAt = updatedAt
    }
    if (oldestIndex < 0) break
    draft.session.splice(oldestIndex, 1)
  }
}

function cleanupSessionCaches(
  draft: State,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  dropSessionCaches(draft, [sessionID])
}
