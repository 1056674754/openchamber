import type { Part } from "@opencode-ai/sdk/v2"

// Cross-repo markers from oh-my-openagent — see oh-my-openagent/src/shared/internal-initiator-marker.ts
// and oh-my-openagent/src/shared/system-directive.ts
const OMO_INTERNAL_INITIATOR = "<!-- OMO_INTERNAL_INITIATOR -->"
const OPENCODE_CONTINUATION_TEXT = "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed."
export const DIRECTIVE_TYPE_CONTINUATION = "CONTINUATION"
const SYSTEM_REMINDER_OPEN = "<system-reminder>"
const SYSTEM_DIRECTIVE_PREFIX = "[SYSTEM DIRECTIVE: OH-MY-OPENCODE"

const textPartHasDirectiveMarker = (part: Part): boolean => {
  if (part.type !== "text") return false
  const text = (part as { text?: unknown }).text
  if (typeof text !== "string") return false

  // OMO_INTERNAL_INITIATOR is always appended at the END by createInternalAgentTextPart().
  if (text.trimEnd().endsWith(OMO_INTERNAL_INITIATOR)) return true

  // Atlas hooks wrap content in <system-reminder>...</system-reminder> pairs.
  if (text.includes(SYSTEM_REMINDER_OPEN) && text.includes("</system-reminder>")) return true

  // Directive prefix always appears at the START of the message.
  if (text.trimStart().startsWith(SYSTEM_DIRECTIVE_PREFIX)) return true

  return false
}

export const isSystemDirectiveMessage = (parts: Part[] | undefined): boolean => {
  if (!Array.isArray(parts) || parts.length === 0) return false
  if (parts.some(textPartHasDirectiveMarker)) return true
  // OpenCode compaction continuation: all parts synthetic + metadata or text match
  if (isCompactionContinuation(parts)) return true
  return false
}

const isCompactionContinuation = (parts: Part[]): boolean => {
  if (!parts.every((p) => Boolean((p as { synthetic?: boolean }).synthetic))) return false
  return parts.some((part) => {
    if (part.type !== "text") return false
    const meta = (part as { metadata?: Record<string, unknown> }).metadata
    if (meta && meta.compaction_continue === true) return true
    const text = (part as { text?: unknown }).text
    return typeof text === "string" && text.includes(OPENCODE_CONTINUATION_TEXT)
  })
}

// "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION]" → "TODO CONTINUATION"
const DIRECTIVE_TYPE_RE = /\[SYSTEM DIRECTIVE: OH-MY-OPENCODE - ([^\]]+)\]/

export const extractDirectiveType = (parts: Part[] | undefined): string | null => {
  if (!Array.isArray(parts)) return null
  if (isCompactionContinuation(parts)) return DIRECTIVE_TYPE_CONTINUATION
  for (const part of parts) {
    if (part.type !== "text") continue
    const text = (part as { text?: unknown }).text
    if (typeof text !== "string") continue
    const match = text.match(DIRECTIVE_TYPE_RE)
    if (match) return match[1]
  }
  return null
}

export const hasOMOMarker = (parts: Part[] | undefined): boolean => {
  if (!Array.isArray(parts)) return false
  return parts.some((part) => {
    if (part.type !== "text") return false
    const text = (part as { text?: unknown }).text
    return typeof text === "string" && text.includes(OMO_INTERNAL_INITIATOR)
  })
}

const STATUS_RE = /\[Status:\s*([^\]]+)\]/

export const extractStatusInfo = (parts: Part[] | undefined): string | null => {
  if (!Array.isArray(parts)) return null
  for (const part of parts) {
    if (part.type !== "text") continue
    const text = (part as { text?: unknown }).text
    if (typeof text !== "string") continue
    const match = text.match(STATUS_RE)
    if (match) return match[1].trim()
  }
  return null
}

const REMAINING_TASK_RE = /^\s*[-*]\s+\[([^\]]+)\]\s+(.+)$/gm

export const extractRemainingTasks = (parts: Part[] | undefined): Array<{ status: string; content: string }> => {
  const tasks: Array<{ status: string; content: string }> = []
  if (!Array.isArray(parts)) return tasks
  for (const part of parts) {
    if (part.type !== "text") continue
    const text = (part as { text?: unknown }).text
    if (typeof text !== "string") continue
    let m: RegExpExecArray | null
    while ((m = REMAINING_TASK_RE.exec(text)) !== null) {
      tasks.push({ status: m[1], content: m[2] })
    }
  }
  return tasks
}
