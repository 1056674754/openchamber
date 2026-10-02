/**
 * v2 send path helpers (OC2 spine S6). The fork's `OpencodeService` send
 * methods branch on the dual-track handle: everything here runs only when the
 * owning server's protocol mode is v2 — the v1 track never imports a runtime
 * symbol from this module's call sites' branch bodies.
 *
 * Semantics mirror upstream `654705f7d`'s client rewrite, narrowed to the
 * fork's send surface:
 * - the prompt is `session.prompt` with the client-generated message id, so
 *   the optimistic user message reconciles in place when the server echoes it;
 * - v2 takes the model/agent from the SESSION record, so a send whose queued
 *   config differs switches the session first ("capture at queue time, apply
 *   before send");
 * - every send rides `sendWithProviderCircuit` so a provider error storm trips
 *   the same breaker both tracks share;
 * - errors leave with a numeric `status` attached, the contract the fork's
 *   send-failure classification and the provider tracker read.
 */

import type { OpenCodeClient } from "@opencode/client"

/** v2 prompt file attachment: the URI form the 2.x wire takes. */
export type V2PromptFile = { uri: string; name?: string; description?: string }

/** A skill name resolved against the directory's skill list. */
export type V2SkillAttachment = { id: string; name: string }

export type SkillMentions = {
  names: readonly string[]
  /**
   * Builds the fallback instruction for skills that could not be attached
   * (unlisted name, failed list, or a skill removed before the prompt).
   * Shared with the command/queue routes via `buildSkillMentionInstruction`.
   */
  instructionFor?: (names: readonly string[]) => string | null
}

/** Maps the fork's file input onto the v2 prompt attachment. */
export const toV2PromptFile = (file: { mime: string; filename?: string; url: string }): V2PromptFile => ({
  uri: file.url,
  ...(file.filename ? { name: file.filename } : {}),
})

const STATUS_BY_TAG: ReadonlyMap<string, number> = new Map([
  ["UnauthorizedError", 401],
  ["ForbiddenError", 403],
  ["SessionNotFoundError", 404],
  ["MessageNotFoundError", 404],
  ["PermissionNotFoundError", 404],
  ["FormNotFoundError", 404],
  ["AgentNotFoundError", 404],
  ["CommandNotFoundError", 404],
  ["SkillNotFoundError", 404],
  ["ProviderNotFoundError", 404],
  ["McpServerNotFoundError", 404],
  ["ConflictError", 409],
  ["SessionBusyError", 409],
  ["FormAlreadySettledError", 409],
  ["ServiceUnavailableError", 503],
])

type TaggedError = { _tag?: unknown; message?: unknown; cause?: unknown }

/**
 * Extracts the HTTP status a `@opencode/client` failure carries: the promise
 * client wraps unexpected statuses in a `ClientError` whose cause holds the
 * response status, and tagged server errors arrive as plain records.
 */
export const readV2SendErrorStatus = (error: unknown): number | undefined => {
  if (error && typeof error === "object") {
    const direct = (error as { status?: unknown }).status
    if (typeof direct === "number" && Number.isFinite(direct)) return direct
    const cause = (error as TaggedError).cause
    if (cause && typeof cause === "object") {
      const causeStatus = (cause as { status?: unknown }).status
      if (typeof causeStatus === "number" && Number.isFinite(causeStatus)) return causeStatus
    }
    const tag = (error as TaggedError)._tag
    if (typeof tag === "string") {
      const mapped = STATUS_BY_TAG.get(tag)
      if (mapped !== undefined) return mapped
    }
  }
  return undefined
}

/**
 * Wraps a v2 send failure in the fork's error contract: the original error
 * stays the cause (信 — the raw form reaches the UI), and the wrapper carries
 * the message plus the numeric `status` send-failure classification and the
 * provider tracker read. Errors that carry neither a status nor a server tag
 * pass through unchanged — there is nothing to add.
 */
export const toV2SendError = (operation: string, error: unknown): Error => {
  if (error instanceof Error) {
    const status = readV2SendErrorStatus(error)
    const tagged = typeof (error as TaggedError)._tag === "string" ? (error as TaggedError)._tag : undefined
    if (status === undefined && !tagged) return error
    const detail = typeof (error as { message?: unknown }).message === "string" && (error as { message: string }).message
      ? (error as { message: string }).message
      : tagged ?? "request failed"
    const wrapped = new Error(`${operation} failed${status !== undefined ? ` (${status})` : ""}: ${detail}`, { cause: error })
    Object.defineProperty(wrapped, "status", { value: status, enumerable: true, configurable: true })
    return wrapped
  }
  const status = readV2SendErrorStatus(error)
  const wrapped = new Error(`${operation} failed${status !== undefined ? ` (${status})` : ""}: ${String(error)}`, { cause: error })
  Object.defineProperty(wrapped, "status", { value: status, enumerable: true, configurable: true })
  return wrapped
}

export type SessionSelection = {
  model?: { providerID: string; modelID: string; variant?: string }
  agent?: string
}

/**
 * Puts the session on the queued model/agent before the prompt. v2 selects
 * both per session, not per prompt; the choice persists until switched. The
 * current session record decides whether a switch is needed at all, so an
 * unchanged send costs no extra round trip. A failed session read is not
 * fatal: the prompt itself is still attempted with the session's current
 * selection rather than blocking the send on a lost race.
 */
export const applySendSelection = async (
  client: OpenCodeClient,
  sessionID: string,
  selection: SessionSelection,
): Promise<void> => {
  if (!selection.model && !selection.agent) return
  type SessionSnapshot = { model?: { providerID?: unknown; id?: unknown; variant?: unknown }; agent?: unknown }
  // A failed session read is not fatal: the prompt itself is still attempted
  // with the session's current selection rather than blocking the send on a
  // lost race.
  const readSession = async (): Promise<SessionSnapshot | null> => {
    try {
      return await client.session.get({ sessionID }) as unknown as SessionSnapshot
    } catch {
      return null
    }
  }
  const current = await readSession()
  const currentModel = current?.model
  const modelChanged = selection.model
    && !(
      currentModel
      && currentModel.providerID === selection.model.providerID
      && currentModel.id === selection.model.modelID
      && (currentModel.variant ?? undefined) === (selection.model.variant ?? undefined)
    )
  if (modelChanged && selection.model) {
    await client.session.switchModel({
      sessionID,
      model: {
        providerID: selection.model.providerID,
        id: selection.model.modelID,
        ...(selection.model.variant ? { variant: selection.model.variant } : {}),
      },
    })
  }
  if (selection.agent && current?.agent !== selection.agent) {
    await client.session.switchAgent({ sessionID, agent: selection.agent })
  }
}

/**
 * Resolves skill names against the directory's skill list (the v2 prompt
 * attaches skills by id). A failed list resolves everything unresolved — the
 * message is never blocked; the fallback instruction names the skills instead.
 */
export const resolveSkillMentions = async (
  client: OpenCodeClient,
  names: readonly string[],
): Promise<{ attached: V2SkillAttachment[]; unresolved: string[] }> => {
  if (names.length === 0) return { attached: [], unresolved: [] }
  let known: Array<{ id: string; name: string }>
  try {
    const listed = await client.skill.list()
    const data = (listed.data ?? []) as Array<{ id?: unknown; name?: unknown }>
    known = data.flatMap((skill) => {
      const id = typeof skill?.id === "string" ? skill.id : undefined
      const name = typeof skill?.name === "string" ? skill.name : undefined
      return id && name ? [{ id, name }] : []
    })
  } catch (error) {
    console.warn("[opencode] Could not list skills; naming them in an instruction instead:", error)
    return { attached: [], unresolved: [...names] }
  }
  const attached: V2SkillAttachment[] = []
  const unresolved: string[] = []
  for (const name of names) {
    const match = known.find((skill) => skill.name === name) ?? known.find((skill) => skill.id === name)
    if (!match) unresolved.push(name)
    else if (!attached.some((skill) => skill.id === match.id)) attached.push({ id: match.id, name })
  }
  return { attached, unresolved }
}

/** True when the failure is the tagged 404 a vanished skill attachment produces. */
export const isV2SkillNotFound = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false
  if ((error as TaggedError)._tag === "SkillNotFoundError") return true
  const cause = (error as TaggedError).cause
  return Boolean(cause && typeof cause === "object" && (cause as TaggedError)._tag === "SkillNotFoundError")
}
