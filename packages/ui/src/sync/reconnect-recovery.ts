import type { SessionStatus, Message, Part } from "@opencode-ai/sdk/v2/client"
import type { Session } from "@opencode-ai/sdk/v2"
import { getSessionMaterializationStatus } from "./materialization"

type ReconnectMaterializationState = {
  session: Session[]
  session_status?: Record<string, SessionStatus>
  message?: Record<string, Message[]>
  part?: Record<string, Part[]>
  question?: Record<string, readonly unknown[]>
  permission?: Record<string, readonly unknown[]>
}

export type ViewedSessionMaterializationTarget = {
  directory: string
  sessionId: string
}

type ReconnectCandidateOptions = {
  directory?: string
  viewedSession?: ViewedSessionMaterializationTarget | null
}

export type ReconnectRecoveryPlan = {
  authoritySessionIds: string[]
  materializationSessionIds: string[]
}

export function getReconnectRecoveryPlan(
  state: ReconnectMaterializationState,
  options?: ReconnectCandidateOptions,
): ReconnectRecoveryPlan {
  const authorityIds = new Set(state.session.map((session) => session.id))
  for (const source of [state.session_status, state.message, state.question, state.permission]) {
    for (const sessionId of Object.keys(source ?? {})) authorityIds.add(sessionId)
  }

  const materializationIds = new Set<string>()

  for (const [sessionId, status] of Object.entries(state.session_status ?? {})) {
    if (status && status.type !== "idle") materializationIds.add(sessionId)
  }

  for (const [sessionId, messages] of Object.entries(state.message ?? {})) {
    const lastMessage = messages[messages.length - 1]
    if (
      lastMessage
      && lastMessage.role === "assistant"
      && typeof (lastMessage as { time?: { completed?: number } }).time?.completed !== "number"
    ) {
      materializationIds.add(sessionId)
    } else if (!getSessionMaterializationStatus({ message: state.message ?? {}, part: state.part ?? {} }, sessionId).renderable) {
      materializationIds.add(sessionId)
    }
  }

  const candidateChildIds = new Set(materializationIds)
  const parentIds = new Set<string>()
  for (const session of state.session) {
    if (!candidateChildIds.has(session.id)) {
      continue
    }
    const parentId = (session as Session & { parentID?: string | null }).parentID
    if (parentId) {
      parentIds.add(parentId)
    }
  }
  for (const pid of parentIds) {
    materializationIds.add(pid)
  }

  const viewedSession = options?.viewedSession
  if (viewedSession?.sessionId && viewedSession.directory === options?.directory) {
    const sessionId = viewedSession.sessionId
    const sessionExists = state.session.some((session) => session.id === sessionId)
      || Object.hasOwn(state.session_status ?? {}, sessionId)
      || Object.hasOwn(state.message ?? {}, sessionId)

    if (sessionExists) {
      materializationIds.add(sessionId)
    }
  }

  return {
    authoritySessionIds: Array.from(authorityIds),
    materializationSessionIds: Array.from(materializationIds),
  }
}
