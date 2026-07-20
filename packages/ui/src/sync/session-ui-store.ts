/**
 * Session UI Store — ephemeral UI state only.
 *
 * Domain data (sessions, messages, parts, permissions, questions, status)
 * lives in sync child stores. This store owns ONLY transient UI concerns:
 * current selection, draft state, viewport anchors, model/agent preferences,
 * voice state, abort prompts, attached files, worktree metadata.
 *
 * Session↔worktree attachments are the authoritative exception: they live in
 * session-worktree-store (shared sync), and session-ui-store routes through it.
 *
 * SDK-calling actions that need domain data read it from sync-refs.
 */

import { create } from "zustand"
import type { Session, Part, Message, TextPart } from "@opencode-ai/sdk/v2/client"
import type { AttachedFile, SessionContextUsage, SessionWorktreeAttachment } from "@/stores/types/sessionTypes"
import type { WorktreeMetadata } from "@/types/worktree"
import type { ProjectEntry } from "@/lib/api/types"
import { opencodeClient } from "@/lib/opencode/client"
import { useConfigStore } from "@/stores/useConfigStore"
import { useProjectsStore } from "@/stores/useProjectsStore"
import { useDirectoryStore } from "@/stores/useDirectoryStore"
import { useSessionFoldersStore } from "@/stores/useSessionFoldersStore"
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from "@/stores/useGlobalSessionsStore"
import { useCommandsStore } from "@/stores/useCommandsStore"
import { useSkillsStore } from "@/stores/useSkillsStore"
import { getSafeStorage } from "@/stores/utils/safeStorage"
import { markPendingUserSendAnimation } from "@/lib/userSendAnimation"
import { flattenAssistantTextParts } from "@/lib/messages/messageText"
import { composeForkSessionMessage } from "@/lib/messages/executionMeta"
import { waitForPendingDraftWorktreeRequest } from "@/lib/worktrees/pendingDraftWorktree"
import { resolveProjectForSessionDirectory } from "@/lib/projectResolution"
import {
  getSyncSessions,
  getAllSyncSessions,
  getSyncMessages,
  getSyncParts,
  getDirectoryState,
  registerSessionDirectory,
  getSessionDirectoryFromRoutingIndex,
  getSyncChildStores,
} from "./sync-refs"
import { markSessionViewed } from "./notification-store"
import { deleteShield } from "./delete-shield"
import { setActiveSession } from "./sync-context"
import {
  createSession as createSessionAction,
  deleteSession as deleteSessionAction,
  archiveSession as archiveSessionAction,
  updateSessionTitle as updateSessionTitleAction,
  shareSession as shareSessionAction,
  unshareSession as unshareSessionAction,
  optimisticSend,
  materializeReturnedMessage,
  refetchSessionMessages,
  type SendDeliveryMode,
} from "./session-actions"
import { setSessionRoutingContextGetters } from "./session-routing"
import { serverRegistry, DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"
import { getAllSyncStores, getSyncStoresForServer } from "./multi-server-registry"
import { useInputStore, type SyntheticContextPart } from "./input-store"
import { useSelectionStore } from "./selection-store"
import { useViewportStore } from "./viewport-store"
import { useSessionWorktreeStore } from "./session-worktree-store"
import { getAttachedSessionDirectory } from "./session-worktree-contract"
import { savePendingMessage, deletePendingMessage } from "./pending-message"
import { resolveSlashRouteTarget } from "./slash-routing"
import { findLatestRealUserMessage, isRealUserMessage } from "@/lib/messages/real-user"
import {
  applyDraftPermissionIntentAfterSessionCreation,
  createDraftPermissionIntent,
  type DraftPermissionIntent,
} from "./draft-permission-intent"

export type { AttachedFile }

// ---------------------------------------------------------------------------
// Send routing — shell mode, slash commands, or normal prompt
// ---------------------------------------------------------------------------

const USER_SHELL_MARKER_TEXT = "The following tool was executed by the user"

export function routeMessage(params: {
  sessionId: string
  content: string
  providerID: string
  modelID: string
  agent?: string
  agentMentionName?: string
  variant?: string
  inputMode?: "normal" | "shell"
  files?: Array<{ type: "file"; mime: string; url: string; filename: string }>
  additionalParts?: Array<{ text: string; synthetic?: boolean; files?: Array<{ type: "file"; mime: string; url: string; filename: string }> }>
  directory?: string | null
  serverId?: string | null
  deliveryMode?: SendDeliveryMode
}): Promise<void> {
  const sessionDirectory = normalizePath(params.directory)
    ?? useSessionUIStore.getState().getDirectoryForSession(params.sessionId)
  if (!sessionDirectory) {
    throw new Error(`Cannot send message: directory for session ${params.sessionId} is not available`)
  }
  const targetServerId = params.serverId ?? serverRegistry.getServerForSession(params.sessionId)
  registerSessionDirectory(params.sessionId, sessionDirectory)
  if (targetServerId) {
    serverRegistry.indexSession(params.sessionId, targetServerId)
  }

  if (params.inputMode === "shell") {
    const shellAgent = typeof params.agent === "string" && params.agent.trim().length > 0
      ? params.agent.trim()
      : undefined
    if (!shellAgent) {
      throw new Error("Cannot run shell command: agent is not selected")
    }
    return optimisticSend({
      sessionId: params.sessionId,
      content: USER_SHELL_MARKER_TEXT,
      providerID: params.providerID,
      modelID: params.modelID,
      agent: shellAgent,
      directory: sessionDirectory,
      serverId: targetServerId,
      deliveryMode: params.deliveryMode,
      buildOptimisticParts: ({ createPartID }) => [{
        id: createPartID(),
        type: "text",
        text: "/shell",
        shellAction: {
          command: params.content,
          status: "running",
        },
      } as unknown as Part],
      send: async (messageID) => {
        const result = await opencodeClient.sendShell({
          id: params.sessionId,
          providerID: params.providerID,
          modelID: params.modelID,
          command: params.content,
          agent: shellAgent,
          messageId: messageID,
          directory: sessionDirectory,
          serverId: targetServerId,
        })
        materializeReturnedMessage({
          sessionId: params.sessionId,
          record: result,
          directory: sessionDirectory,
          serverId: targetServerId,
          setIdle: true,
        })
      },
    })
  }

  // Slash commands — fire and forget, SSE delivers messages and status
  if (params.content.startsWith("/")) {
    const dirState = getDirectoryState(sessionDirectory)
    const syncCommands = dirState?.command ?? []
    const storeCommands = useCommandsStore.getState().commands
    const storeSkills = useSkillsStore.getState().skills
    const target = resolveSlashRouteTarget(params.content, [syncCommands, storeCommands, storeSkills])

    if (target) {
      return optimisticSend({
        sessionId: params.sessionId,
        content: params.content,
        providerID: params.providerID,
        modelID: params.modelID,
        agent: params.agent,
        files: params.files,
        directory: sessionDirectory,
        serverId: targetServerId,
        deliveryMode: params.deliveryMode,
        send: (messageID) => opencodeClient.sendCommand({
          id: params.sessionId,
          providerID: params.providerID,
          modelID: params.modelID,
          command: target.name,
          arguments: target.arguments,
          agent: params.agent,
          variant: params.variant,
          files: params.files,
          messageId: messageID,
          directory: sessionDirectory,
          serverId: targetServerId,
        }).then(() => {}),
      })
    }
  }

  // Normal prompt — optimistic insert so message appears instantly
  return optimisticSend({
    sessionId: params.sessionId,
    content: params.content,
    providerID: params.providerID,
    modelID: params.modelID,
    agent: params.agent,
    files: params.files,
    directory: sessionDirectory,
    serverId: targetServerId,
    deliveryMode: params.deliveryMode,
    send: (messageID) => opencodeClient.sendMessage({
      id: params.sessionId,
      providerID: params.providerID,
      modelID: params.modelID,
      text: params.content,
      agent: params.agent,
      agentMentions: params.agentMentionName ? [{ name: params.agentMentionName }] : undefined,
      variant: params.variant,
      files: params.files,
      additionalParts: params.additionalParts,
      messageId: messageID,
      directory: sessionDirectory,
      serverId: targetServerId,
      deliveryMode: params.deliveryMode === "steer" ? "steer" : "normal",
    }).then(() => {}),
  })
}

function notifyMessageSent(sessionId: string, directory?: string | null): void {
  void directory
  fetch(`/api/sessions/${encodeURIComponent(sessionId)}/message-sent`, { method: "POST" })
    .catch(() => { /* ignore */ })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { SyntheticContextPart } from "./input-store"
export type { SessionMemoryState } from "./viewport-store"
export type { VoiceStatus, VoiceMode } from "./voice-store"

export type NewSessionDraftState = {
  open: boolean
  submitting?: boolean
  selectedProjectId?: string | null
  directoryOverride: string | null
  permissionIntent: DraftPermissionIntent
  pendingWorktreeRequestId?: string | null
  bootstrapPendingDirectory?: string | null
  preserveDirectoryOverride?: boolean
  parentID: string | null
  title?: string
  initialPrompt?: string
  syntheticParts?: SyntheticContextPart[]
  targetFolderId?: string
}

export type SendMessageTarget = {
  sessionId?: string | null
  directory?: string | null
  serverId?: string | null
  draft?: NewSessionDraftState | null
}

export type ViewportAnchor = {
  sessionId: string
  value: number
}

export type SessionHistoryMeta = {
  limit: number
  hasMore: boolean
  complete: boolean
  isLoading: boolean
  loading?: boolean
  nextCursor?: string
}

export type SessionUIState = {
  currentSessionId: string | null
  newSessionDraft: NewSessionDraftState
  abortPromptSessionId: string | null
  abortPromptExpiresAt: number | null
  error: string | null
  worktreeMetadata: Map<string, WorktreeMetadata>
  availableWorktrees: WorktreeMetadata[]
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>
  webUICreatedSessions: Set<string>
  // Sessions mid-delete: stay in store with disabled row + red wave text
  deletingSessionIds: Set<string>
  sessionAbortFlags: Map<string, { timestamp: number; acknowledged: boolean }>
  abortControllers: Map<string, AbortController>
  isLoading: boolean
  lastLoadedDirectory: string | null
  // Plan mode - per-session plan file availability (set when plan_enter tool creates a plan)
  sessionPlanAvailable: Map<string, boolean>
  markSessionPlanAvailable: (sessionId: string) => void
  isSessionPlanAvailable: (sessionId: string) => boolean

  // Non-Git mode: dismissed signature hash per session, hides bar until new turn arrives
  pendingChangesBarDismissed: Map<string, string>
  dismissPendingChangesBar: (sessionId: string, signature: string | null) => void

  // Actions — UI state management
  /**
   * Switch the displayed session. By default also writes the session's
   * directory to `useDirectoryStore.currentDirectory` and the global SDK
   * directory. Pass `{ syncDirectory: false }` for inspection-only switches
   * (e.g. brief mini-chat focus, programmatic preloads) where the global
   * directory should remain pinned to its current value.
   */
  setCurrentSession: (
    id: string | null,
    directoryHint?: string | null,
    options?: { syncDirectory?: boolean; serverId?: string },
  ) => void
  _pendingNavigationSessionId: string | null
  navigateToSession: (sessionId: string, directory: string, projectId: string) => void
  consumeNavigationIntent: () => string | null
  openNewSessionDraft: (options?: Partial<NewSessionDraftState>) => void
  closeNewSessionDraft: () => void
  setNewSessionDraftTarget: (target: { projectId?: string | null; selectedProjectId?: string | null; directoryOverride?: string | null }, options?: { force?: boolean }) => void
  setDraftPreserveDirectoryOverride: (value: boolean) => void
  setDraftPermissionAutoAccept: (enabled: boolean) => void
  acknowledgeSessionAbort: (sessionId: string) => void
  clearAbortPrompt: () => void
  armAbortPrompt: (durationMs?: number) => number | null
  clearError: () => void
  markSessionAsOpenChamberCreated: (sessionId: string) => void
  isOpenChamberCreatedSession: (sessionId: string) => boolean
  markSessionDeleting: (sessionId: string) => void
  unmarkSessionDeleting: (sessionId: string) => void
  isSessionDeleting: (sessionId: string) => boolean
  getContextUsage: (contextLimit: number, outputLimit: number) => SessionContextUsage | null
  initializeNewOpenChamberSession: (sessionId: string, agents: unknown[]) => void
  setWorktreeMetadata: (sessionId: string, metadata: WorktreeMetadata | null) => void
  overrideNewSessionDraftTarget: (options: Record<string, unknown>) => void
  resolvePendingDraftWorktreeTarget: (requestId: string, directory: string | null, options?: Record<string, unknown>) => void
  setDraftBootstrapPendingDirectory: (directory: string | null) => void
  setPendingDraftWorktreeRequest: (requestId: string | null) => void
  getWorktreeMetadata: (sessionId: string) => WorktreeMetadata | undefined

  // Actions — SDK-calling operations (read domain data from sync-refs)
  sendMessage: (
    content: string,
    providerID: string,
    modelID: string,
    agent?: string,
    attachments?: AttachedFile[],
    agentMentionName?: string,
    additionalParts?: Array<{ text: string; attachments?: AttachedFile[]; synthetic?: boolean }>,
    variant?: string,
    inputMode?: "normal" | "shell",
    target?: string | SendMessageTarget,
    deliveryMode?: SendDeliveryMode,
  ) => Promise<void>

  createSession: (
    title?: string,
    directoryOverride?: string | null,
    parentID?: string | null,
    serverIdOverride?: string | null,
    options?: { select?: boolean },
    metadata?: Record<string, unknown>,
  ) => Promise<Session | null>
  deleteSession: (id: string, options?: Record<string, unknown>) => Promise<boolean>
  deleteSessions: (ids: string[], options?: Record<string, unknown>) => Promise<{ deletedIds: string[]; failedIds: string[] }>
  archiveSession: (id: string) => Promise<boolean>
  archiveSessions: (ids: string[], options?: Record<string, unknown>) => Promise<{ archivedIds: string[]; failedIds: string[] }>
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>
  shareSession: (sessionId: string) => Promise<Session | null>
  unshareSession: (sessionId: string) => Promise<Session | null>
  revertToMessage: (sessionId: string, messageId: string, options?: { skipRedoPush?: boolean }) => Promise<void>
  forkFromMessage: (sessionId: string, messageId: string) => Promise<void>
  handleSlashUndo: (sessionId: string) => Promise<void>
  handleSlashRedo: (sessionId: string, options?: { fullUnrevert?: boolean }) => Promise<void>
  handleSlashCompact: (content: string, sessionId: string) => Promise<void>
  tryDispatchLocalSlashCommand: (content: string, sessionId: string) => Promise<boolean>
  createSessionFromAssistantMessage: (sourceMessageId: string, execution: { providerID: string; modelID: string; variant: string; agent: string; instructions: string }) => Promise<void>

  // Data access helpers (read from sync)
  getSessionsByDirectory: (directory: string) => Session[]
  getDirectoryForSession: (sessionId: string) => string | null
  getLastUserChoice: (sessionId: string) => { agent?: string; providerID?: string; modelID?: string; variant?: string } | null
  getCurrentAgent: (sessionId: string) => string | undefined
  debugSessionMessages: (sessionId: string) => Promise<void>
  pollForTokenUpdates: () => void
  setSessionDirectory: (sessionId: string, directory: string | null) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const normalizePath = (value?: string | null): string | null => {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const replaced = trimmed.replace(/\\/g, "/")
  if (replaced === "/") return "/"
  return replaced.length > 1 ? replaced.replace(/\/+$/, "") : replaced
}

const resolveDirectoryKey = (session: Session): string | null => {
  const sessionRecord = session as Session & {
    directory?: string | null
    project?: { worktree?: string | null } | null
  }
  return normalizePath(sessionRecord.directory ?? null)
    ?? normalizePath(sessionRecord.project?.worktree ?? null)
}

const safeStorage = getSafeStorage()
const DRAFT_TARGET_STORAGE_KEY = "oc.chatInput.lastDraftTarget"

type PersistedDraftTarget = { projectId: string | null; directory: string | null }

const readPersistedDraftTarget = (): PersistedDraftTarget | null => {
  try {
    const raw = safeStorage.getItem(DRAFT_TARGET_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { projectId?: unknown; directory?: unknown }
    return {
      projectId: typeof parsed?.projectId === "string" ? parsed.projectId : null,
      directory: normalizePath(typeof parsed?.directory === "string" ? parsed.directory : null),
    }
  } catch {
    return null
  }
}

const persistDraftTarget = (target: PersistedDraftTarget): void => {
  try {
    safeStorage.setItem(DRAFT_TARGET_STORAGE_KEY, JSON.stringify(target))
  } catch { /* ignored */ }
}

const resolveDraftProjectForDirectory = resolveProjectForSessionDirectory

const normalizeProjectServerId = (serverId?: string | null): string =>
  serverId && serverId !== DEFAULT_SERVER_ID ? serverId : DEFAULT_SERVER_ID

const normalizeOptionalServerId = (serverId?: string | null): string | undefined =>
  serverId ? normalizeProjectServerId(serverId) : undefined

const normalizeSendTarget = (target?: string | SendMessageTarget): SendMessageTarget => (
  typeof target === "string"
    ? { sessionId: target }
    : target ?? {}
)

const projectOwnsDirectory = (
  project: ProjectEntry | null | undefined,
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
  directory: string | null | undefined,
): boolean => {
  if (!project || !directory) return false
  return resolveProjectForSessionDirectory([project], availableWorktreesByProject, directory)?.id === project.id
}

const getAttachmentForSession = (sessionId: string | null | undefined): SessionWorktreeAttachment | undefined => {
  if (!sessionId) return undefined
  return useSessionWorktreeStore.getState().getAttachment(sessionId)
}

const resolveSessionDirectory = (
  sessionId: string | null | undefined,
  getWtMeta: (id: string) => WorktreeMetadata | undefined,
  serverId?: string,
): string | null => {
  if (!sessionId) return null
  const attachmentDirectory = getAttachedSessionDirectory(getAttachmentForSession(sessionId))
  if (attachmentDirectory) return attachmentDirectory
  const metaPath = getWtMeta(sessionId)?.path
  if (typeof metaPath === "string" && metaPath.trim().length > 0) return normalizePath(metaPath)

  // If serverId is known and remote, search ONLY that server's child stores.
  // Never fall back to local when the session is known to be remote.
  if (serverId && serverId !== DEFAULT_SERVER_ID) {
    const remoteStores = getSyncStoresForServer(serverId)
    if (remoteStores) {
      for (const store of remoteStores.children.values()) {
        const target = store.getState().session.find((s) => s.id === sessionId)
        if (target) return resolveDirectoryKey(target)
      }
    }
    // Remote server's stores don't contain this session yet.
    // Do NOT fall back to local — return null and let directoryHint handle it.
    return null
  }

  // No serverId or DEFAULT — search local child stores only (not getAllSyncSessions).
  const sessions = getSyncSessions()
  const target = sessions.find((s) => s.id === sessionId)
  if (!target) return null
  return resolveDirectoryKey(target)
}

const findServerIdForLoadedSession = (
  sessionId: string | null | undefined,
  directoryHint?: string | null,
): string | undefined => {
  if (!sessionId) return undefined
  const normalizedHint = normalizePath(directoryHint)
  const matches: string[] = []

  for (const entry of getAllSyncStores()) {
    for (const [storeDirectory, store] of entry.childStores.children) {
      const session = store.getState().session.find((candidate) => candidate.id === sessionId)
      if (!session) {
        continue
      }

      if (normalizedHint) {
        const normalizedStoreDirectory = normalizePath(storeDirectory)
        const sessionDirectory = resolveDirectoryKey(session)
        if (normalizedHint !== normalizedStoreDirectory && normalizedHint !== sessionDirectory) {
          continue
        }
      }

      matches.push(normalizeProjectServerId(entry.serverId))
    }
  }

  if (matches.length === 1) {
    return matches[0]
  }

  const uniqueMatches = new Set(matches)
  return uniqueMatches.size === 1 ? matches[0] : undefined
}

const resolveRemoteServerIdForDirectory = (
  directory: string | null | undefined,
  projects: ProjectEntry[],
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
): string | undefined => {
  const project = resolveProjectForSessionDirectory(projects, availableWorktreesByProject, directory ?? null)
  const serverId = normalizeOptionalServerId(project?.serverId)
  return serverId && serverId !== DEFAULT_SERVER_ID ? serverId : undefined
}

const activateConfigForDirectory = async (
  directory: string | null | undefined,
  serverId?: string | null,
): Promise<void> => {
  await useConfigStore.getState().activateDirectory(normalizePath(directory), { serverId })
}

const migrateDraftPermissionIntentToCreatedSession = async (
  sessionId: string,
  draft: NewSessionDraftState,
): Promise<void> => {
  if (!draft.permissionIntent.autoAccept) {
    return
  }

  const { usePermissionStore } = await import("@/stores/permissionStore")
  await applyDraftPermissionIntentAfterSessionCreation({
    sessionId,
    intent: draft.permissionIntent,
    setSessionAutoAccept: usePermissionStore.getState().setSessionAutoAccept,
  })
}

const DEFAULT_DRAFT: NewSessionDraftState = {
  open: false,
  directoryOverride: null,
  permissionIntent: createDraftPermissionIntent(),
  parentID: null,
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSessionUIStore = create<SessionUIState>()((set, get) => ({
  currentSessionId: null,
  newSessionDraft: { ...DEFAULT_DRAFT },
  abortPromptSessionId: null,
  abortPromptExpiresAt: null,
  error: null,
  worktreeMetadata: new Map(),
  availableWorktrees: [],
  availableWorktreesByProject: new Map(),
    webUICreatedSessions: new Set(),
    deletingSessionIds: new Set(),
  sessionAbortFlags: new Map(),
  abortControllers: new Map(),
  isLoading: false,
  lastLoadedDirectory: null,
  sessionPlanAvailable: new Map(),
  pendingChangesBarDismissed: new Map(),

  // ---------------------------------------------------------------------------
  // setCurrentSession
  // ---------------------------------------------------------------------------
  setCurrentSession: (id, directoryHint?: string | null, options?: { syncDirectory?: boolean; serverId?: string }) => {
    if (id) {
      get().closeNewSessionDraft()
    }

    const previousSessionId = get().currentSessionId

    const directoryState = useDirectoryStore.getState()

    const directoryHintNormalized = directoryHint ? normalizePath(directoryHint) : null
    const inferredDirectory = directoryHintNormalized ?? (id ? get().getDirectoryForSession(id) : null)
    const resolvedServerId = options?.serverId
      ?? (id ? serverRegistry.getServerForSession(id) : undefined)
      ?? findServerIdForLoadedSession(id, inferredDirectory)
      ?? resolveRemoteServerIdForDirectory(
        inferredDirectory,
        useProjectsStore.getState().projects,
        get().availableWorktreesByProject,
      )

    const sessionDir = resolveSessionDirectory(
      id,
      (sid) => get().worktreeMetadata.get(sid),
      resolvedServerId,
    )
    const resolvedDir = sessionDir ?? inferredDirectory

    if (id && resolvedServerId && resolvedServerId !== DEFAULT_SERVER_ID && !resolvedDir) {
      set({ error: `Directory for remote session ${id} on ${resolvedServerId} is not available` })
      return
    }

    // Pin the new session's child store to prevent eviction while active.
    // Unpin the previous session's directory when switching away.
    try {
      if (previousSessionId && previousSessionId !== id) {
        const prevDir = get().getDirectoryForSession(previousSessionId)
        if (prevDir) getSyncChildStores().unpin(prevDir)
      }
    } catch { /* child stores may not be initialized yet */ }

    set({ currentSessionId: id })

    if (id && resolvedDir) {
      registerSessionDirectory(id, resolvedDir)
    }
    if (id && resolvedServerId) {
      serverRegistry.indexSession(id, resolvedServerId)
    }

    const shouldSyncDirectory = options?.syncDirectory !== false

    try {
      if (shouldSyncDirectory && resolvedDir && directoryState.currentDirectory !== resolvedDir) {
        directoryState.setDirectory(resolvedDir, { showOverlay: false })
      }
      if (shouldSyncDirectory && resolvedDir) {
        opencodeClient.setDirectory(resolvedDir)
      }
      if (resolvedDir) {
        void activateConfigForDirectory(resolvedDir, resolvedServerId)
      }
    } catch (e) {
      console.warn("Failed to set OpenCode directory for session switch:", e)
    }

    // Defer viewport anchor save for previous session — not needed for the
    // skeleton to render and reads messages which can be expensive.
    if (previousSessionId && previousSessionId !== id) {
      const prevId = previousSessionId
      setTimeout(() => {
        const memState = useViewportStore.getState().sessionMemoryState.get(prevId)
        if (!memState?.isStreaming) {
          const prevMessages = getSyncMessages(prevId)
          if (prevMessages.length > 0) {
            useViewportStore.getState().updateViewportAnchor(prevId, prevMessages.length - 1)
          }
        }
      }, 0)
    }

    // Mark session viewed in notification store + update active session ref
    if (id) {
      markSessionViewed(id)
      if (resolvedDir) {
        setActiveSession(resolvedDir, id)
        try { getSyncChildStores().pin(resolvedDir) } catch { /* not initialized */ }
      } else {
        setActiveSession("", "")
      }
    } else {
      setActiveSession("", "")
    }
  },

  // ---------------------------------------------------------------------------
  // navigateToSession — atomic project + directory + session switch
  // ---------------------------------------------------------------------------
  _pendingNavigationSessionId: null as string | null,
  navigateToSession: (sessionId, directory, projectId) => {
    const project = projectId
      ? useProjectsStore.getState().projects.find((p) => p.id === projectId)
      : null
    const serverId = project?.serverId ?? DEFAULT_SERVER_ID
    set({ _pendingNavigationSessionId: sessionId })
    get().setCurrentSession(sessionId, directory, { serverId })
    useProjectsStore.getState().setActiveProjectIdOnly(projectId)
  },
  consumeNavigationIntent: () => {
    const id = get()._pendingNavigationSessionId
    if (id) {
      set({ _pendingNavigationSessionId: null })
    }
    return id
  },

  // ---------------------------------------------------------------------------
  // openNewSessionDraft
  // ---------------------------------------------------------------------------
  openNewSessionDraft: (options) => {
    const projectsState = useProjectsStore.getState()
    const projects = projectsState.projects
    const availableWorktreesByProject = get().availableWorktreesByProject
    const activeProject = projectsState.getActiveProject()
    const currentDirectory = normalizePath(useDirectoryStore.getState().currentDirectory ?? null)
    const persistedTarget = readPersistedDraftTarget()

    const explicitDirectory = options?.directoryOverride !== undefined
      ? normalizePath(options.directoryOverride)
      : null
    const explicitProject = options?.selectedProjectId
      ? projects.find((p) => p.id === options.selectedProjectId) ?? null
      : null

    const inferredProjectFromDir = resolveDraftProjectForDirectory(projects, availableWorktreesByProject, explicitDirectory)
    const fallbackProject = (() => {
      if (activeProject) return activeProject
      if (projectsState.activeProjectId) return projects.find((p) => p.id === projectsState.activeProjectId) ?? null
      return projects[0] ?? null
    })()

    const persistedProjectById = persistedTarget?.projectId
      ? projects.find((p) => p.id === persistedTarget.projectId) ?? null
      : null
    const persistedProjectByDir = resolveDraftProjectForDirectory(projects, availableWorktreesByProject, persistedTarget?.directory ?? null)
    const currentDirProject = resolveDraftProjectForDirectory(projects, availableWorktreesByProject, currentDirectory)

    const isTempSession = options?.preserveDirectoryOverride === false

    const selectedProject = (() => {
      if (isTempSession) return null
      if (explicitProject) return explicitProject
      if (explicitDirectory !== null) return inferredProjectFromDir
      if (currentDirectory) return currentDirProject ?? fallbackProject
      return persistedProjectByDir ?? persistedProjectById ?? fallbackProject
    })()

    const directory = isTempSession
      ? null
      : (() => {
          if (explicitDirectory !== null) return explicitDirectory
          if (explicitProject) return normalizePath(explicitProject.path ?? null)
          if (currentDirectory) return currentDirectory
          if (persistedTarget?.directory) return persistedTarget.directory
          return normalizePath(selectedProject?.path ?? null)
        })()

    if (!isTempSession) {
      persistDraftTarget({ projectId: selectedProject?.id ?? null, directory })
    }

    set({
      newSessionDraft: {
        open: true,
        selectedProjectId: selectedProject?.id ?? null,
        directoryOverride: directory,
        permissionIntent: createDraftPermissionIntent(options?.permissionIntent?.autoAccept),
        pendingWorktreeRequestId: options?.pendingWorktreeRequestId ?? null,
        bootstrapPendingDirectory: normalizePath(options?.bootstrapPendingDirectory ?? null),
        preserveDirectoryOverride: options?.preserveDirectoryOverride,
        parentID: options?.parentID ?? null,
        title: options?.title,
        initialPrompt: options?.initialPrompt,
        syntheticParts: options?.syntheticParts,
        targetFolderId: options?.targetFolderId,
      },
      currentSessionId: null,
      error: null,
    })

    // Clear composer attachments when opening a new session draft.
    // Attachments restored by revert/fork must not bleed into the new draft.
    useInputStore.getState().clearAttachedFiles()

    if (options?.initialPrompt) {
      useInputStore.getState().setPendingInputText(options.initialPrompt)
    }

    if (directory) {
      void activateConfigForDirectory(directory, selectedProject?.serverId)
    }
  },

  // ---------------------------------------------------------------------------
  // closeNewSessionDraft
  // ---------------------------------------------------------------------------
  closeNewSessionDraft: () => {
    set({
      newSessionDraft: {
        open: false,
        selectedProjectId: null,
        directoryOverride: null,
        permissionIntent: createDraftPermissionIntent(),
        pendingWorktreeRequestId: null,
        bootstrapPendingDirectory: null,
        preserveDirectoryOverride: false,
        parentID: null,
        title: undefined,
        initialPrompt: undefined,
        syntheticParts: undefined,
        targetFolderId: undefined,
      },
    })
  },

  setNewSessionDraftTarget: (target) => {
    let nextDirectory: string | null = null
    let nextServerId: string | null | undefined
    set((s) => {
      nextDirectory = normalizePath(target.directoryOverride ?? s.newSessionDraft.directoryOverride)
      const nextProjectId = target.projectId ?? target.selectedProjectId ?? s.newSessionDraft.selectedProjectId
      nextServerId = nextProjectId
        ? useProjectsStore.getState().projects.find((project) => project.id === nextProjectId)?.serverId
        : undefined
      return {
        newSessionDraft: {
          ...s.newSessionDraft,
          selectedProjectId: nextProjectId,
          directoryOverride: target.directoryOverride ?? s.newSessionDraft.directoryOverride,
        },
      }
    })
    void activateConfigForDirectory(nextDirectory, nextServerId)
  },

  setDraftPreserveDirectoryOverride: (value) =>
    set((s) => {
      if (!s.newSessionDraft?.open) return s
      return { newSessionDraft: { ...s.newSessionDraft, preserveDirectoryOverride: value } }
    }),

  setDraftPermissionAutoAccept: (enabled) =>
    set((s) => {
      if (!s.newSessionDraft.open) return s
      return {
        newSessionDraft: {
          ...s.newSessionDraft,
          permissionIntent: createDraftPermissionIntent(enabled),
        },
      }
    }),

  acknowledgeSessionAbort: (sessionId) =>
    set((s) => {
      const flags = new Map(s.sessionAbortFlags)
      const existing = flags.get(sessionId)
      if (existing) flags.set(sessionId, { ...existing, acknowledged: true })
      return { sessionAbortFlags: flags }
    }),

  clearAbortPrompt: () => set({ abortPromptSessionId: null, abortPromptExpiresAt: null }),

  armAbortPrompt: (durationMs = 5000) => {
    const { currentSessionId } = get()
    if (!currentSessionId) return null
    const expiresAt = Date.now() + durationMs
    set({ abortPromptSessionId: currentSessionId, abortPromptExpiresAt: expiresAt })
    return expiresAt
  },

  clearError: () => set({ error: null }),

  markSessionAsOpenChamberCreated: (sessionId) =>
    set((s) => {
      const next = new Set(s.webUICreatedSessions)
      next.add(sessionId)
      return { webUICreatedSessions: next }
    }),

  isOpenChamberCreatedSession: (sessionId) => get().webUICreatedSessions.has(sessionId),

  markSessionDeleting: (sessionId) =>
    set((s) => {
      if (s.deletingSessionIds.has(sessionId)) return s
      const next = new Set(s.deletingSessionIds)
      next.add(sessionId)
      deleteShield.add(sessionId)
      return { deletingSessionIds: next }
    }),

  unmarkSessionDeleting: (sessionId) =>
    set((s) => {
      if (!s.deletingSessionIds.has(sessionId)) return s
      const next = new Set(s.deletingSessionIds)
      next.delete(sessionId)
      deleteShield.delete(sessionId)
      return { deletingSessionIds: next }
    }),

  isSessionDeleting: (sessionId) => get().deletingSessionIds.has(sessionId),

  getContextUsage: (contextLimit: number, outputLimit: number) => {
    if (get().newSessionDraft?.open) return null
    const sessionId = get().currentSessionId
    if (!sessionId) return null

    const sessionServerId = serverRegistry.getServerForSession(sessionId)
    const directory = get().getDirectoryForSession(sessionId) ?? undefined
    const messages = (() => {
      if (sessionServerId && sessionServerId !== DEFAULT_SERVER_ID) {
        const remoteStores = getSyncStoresForServer(sessionServerId)
        if (!remoteStores) return []
        const directoryMessages = directory
          ? remoteStores.children.get(directory)?.getState().message[sessionId]
          : undefined
        if (directoryMessages) return directoryMessages
        for (const store of remoteStores.children.values()) {
          const sessionMessages = store.getState().message[sessionId]
          if (sessionMessages) return sessionMessages
        }
        return []
      }
      return getSyncMessages(sessionId, directory)
    })()
    if (messages.length === 0) return null

    type AssistantTokens = { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    let lastTokens: AssistantTokens | undefined
    let lastMessageId: string | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== "assistant") continue
      const tokens = (msg as { tokens?: AssistantTokens }).tokens
      if (!tokens) continue
      const total = tokens.input + tokens.output + tokens.reasoning + (tokens.cache?.read ?? 0) + (tokens.cache?.write ?? 0)
      if (total > 0) {
        lastTokens = tokens
        lastMessageId = msg.id
        break
      }
    }

    if (!lastTokens) return null

    const totalTokens = lastTokens.input + lastTokens.output + lastTokens.reasoning + (lastTokens.cache?.read ?? 0) + (lastTokens.cache?.write ?? 0)
    const thresholdLimit = contextLimit > 0 ? contextLimit : 200000
    const percentage = contextLimit > 0 ? Math.round((totalTokens / contextLimit) * 100) : 0
    const normalizedOutput = outputLimit > 0 ? Math.round((lastTokens.output / outputLimit) * 100) : undefined

    return {
      totalTokens,
      percentage,
      contextLimit: contextLimit || 0,
      outputLimit: outputLimit || undefined,
      normalizedOutput,
      thresholdLimit,
      lastMessageId,
    }
  },

  initializeNewOpenChamberSession: () => {
    // Stub — was a no-op in old store
  },

  setWorktreeMetadata: (sessionId, metadata) => {
    // Write to authoritative session-worktree-store
    if (metadata) {
      useSessionWorktreeStore.getState().setAttachment(sessionId, {
        worktreeRoot: metadata.worktreeRoot ?? metadata.path ?? null,
        cwd: metadata.path ?? null,
        branch: metadata.branch ?? null,
        headState: metadata.headState ?? (metadata.branch ? 'branch' : 'detached'),
        worktreeStatus: metadata.worktreeStatus ?? 'ready',
        worktreeSource: metadata.worktreeSource ?? null,
        legacy: false,
        degraded: false,
      })
    } else {
      useSessionWorktreeStore.getState().clearAttachment(sessionId)
    }
    // Also keep local map for backward compatibility
    set((s) => {
      const map = new Map(s.worktreeMetadata)
      if (metadata) map.set(sessionId, metadata)
      else map.delete(sessionId)
      return { worktreeMetadata: map }
    })
  },

  overrideNewSessionDraftTarget: (options) => {
    let nextDirectory: string | null = null
    let nextServerId: string | null | undefined
    set((s) => {
      const nextDraft = { ...s.newSessionDraft, ...options }
      nextDirectory = normalizePath(
        typeof nextDraft.directoryOverride === "string" ? nextDraft.directoryOverride : null,
      )
      nextServerId = typeof nextDraft.selectedProjectId === "string"
        ? useProjectsStore.getState().projects.find((project) => project.id === nextDraft.selectedProjectId)?.serverId
        : undefined
      return { newSessionDraft: nextDraft }
    })
    void activateConfigForDirectory(nextDirectory, nextServerId)
  },

  resolvePendingDraftWorktreeTarget: (requestId, directory, options) =>
    set((s) => {
      if (!s.newSessionDraft?.open || s.newSessionDraft.pendingWorktreeRequestId !== requestId) return s
      return {
        newSessionDraft: {
          ...s.newSessionDraft,
          selectedProjectId: (options as Record<string, unknown> | undefined)?.projectId as string ?? s.newSessionDraft.selectedProjectId ?? null,
          directoryOverride: normalizePath(directory),
          pendingWorktreeRequestId: null,
          bootstrapPendingDirectory: normalizePath((options as Record<string, unknown> | undefined)?.bootstrapPendingDirectory as string ?? s.newSessionDraft.bootstrapPendingDirectory ?? null),
          preserveDirectoryOverride: ((options as Record<string, unknown> | undefined)?.preserveDirectoryOverride ?? s.newSessionDraft.preserveDirectoryOverride) as boolean | undefined,
        },
      }
    }),

  setDraftBootstrapPendingDirectory: (directory) =>
    set((s) => {
      if (!s.newSessionDraft?.open) return s
      return { newSessionDraft: { ...s.newSessionDraft, bootstrapPendingDirectory: normalizePath(directory) } }
    }),

  setPendingDraftWorktreeRequest: (requestId) =>
    set((s) => {
      if (!s.newSessionDraft?.open) return s
      return { newSessionDraft: { ...s.newSessionDraft, pendingWorktreeRequestId: requestId } }
    }),

  getWorktreeMetadata: (sessionId) => get().worktreeMetadata.get(sessionId),

  dismissPendingChangesBar: (sessionId, signature) => {
    const map = new Map(get().pendingChangesBarDismissed);
    if (signature === null) {
      map.delete(sessionId);
    } else {
      map.set(sessionId, signature);
    }
    set({ pendingChangesBarDismissed: map });
  },

  // ---------------------------------------------------------------------------
  // sendMessage — calls SDK, reads domain data from sync
  // ---------------------------------------------------------------------------
  sendMessage: async (
    content: string,
    providerID: string,
    modelID: string,
    agent?: string,
    attachments?: AttachedFile[],
    agentMentionName?: string,
    additionalParts?: Array<{ text: string; attachments?: AttachedFile[]; synthetic?: boolean }>,
    variant?: string,
    inputMode?: "normal" | "shell",
    target?: string | SendMessageTarget,
    deliveryMode: SendDeliveryMode = "normal",
  ) => {
    // Clear non-Git changed-files bar on new user message for current session
    const sendTarget = normalizeSendTarget(target)
    const targetSessionId = typeof sendTarget.sessionId === "string" && sendTarget.sessionId.trim().length > 0
      ? sendTarget.sessionId.trim()
      : undefined
    const targetDirectory = normalizePath(sendTarget.directory ?? null)
    const targetServerId = normalizeOptionalServerId(sendTarget.serverId)
    const sid = targetSessionId ?? get().currentSessionId;
    if (sid) {
      const map = new Map(get().pendingChangesBarDismissed);
      map.delete(sid);
      set({ pendingChangesBarDismissed: map });
    }

    const draft = targetSessionId ? null : (sendTarget.draft ?? get().newSessionDraft)
    const trimmedAgent = typeof agent === "string" && agent.trim().length > 0 ? agent.trim() : undefined

    // ---- New session from draft ----
    if (draft?.open) {
      const draftTargetFolderId = draft.targetFolderId
      let draftDirectoryOverride = draft.bootstrapPendingDirectory ?? draft.directoryOverride ?? null
      const draftProjectId = draft.selectedProjectId ?? null
      const isTempDraft = draft.preserveDirectoryOverride === false
      const draftSnap = { ...draft }
      const isCapturedDraftSend = sendTarget.draft != null
      const isLiveDraftStillTarget = () => {
        if (!isCapturedDraftSend) return true
        const live = get()
        const liveDraft = live.newSessionDraft
        if (live.currentSessionId !== null || !liveDraft.open) return false
        if (
          draft.pendingWorktreeRequestId
          && liveDraft.pendingWorktreeRequestId === draft.pendingWorktreeRequestId
        ) {
          return true
        }
        const liveDirectory = normalizePath(liveDraft.bootstrapPendingDirectory ?? liveDraft.directoryOverride)
        const targetDirectory = normalizePath(draftDirectoryOverride)
        return liveDirectory === targetDirectory
          && (draftProjectId === null || liveDraft.selectedProjectId === draftProjectId)
      }

      if (isLiveDraftStillTarget()) {
        set({ newSessionDraft: { ...get().newSessionDraft, submitting: true } })
      }

      try {
      if (draft.pendingWorktreeRequestId) {
        draftDirectoryOverride = await waitForPendingDraftWorktreeRequest(draft.pendingWorktreeRequestId)
        get().resolvePendingDraftWorktreeTarget(draft.pendingWorktreeRequestId, draftDirectoryOverride)
      }

      // For temp sessions: use zen API to generate topic, create directory + OpenCode session
      if (isTempDraft) {
        try {
          const text = content.trim()
          let topic = `untitled-${Date.now()}`
          if (text) {
            try {
              const summarizeResponse = await fetch("/api/text/summarize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, mode: "topic", maxLength: 50, threshold: 0 }),
              })
              if (summarizeResponse.ok) {
                const data = await summarizeResponse.json()
                if (data?.summary) topic = data.summary
              }
            } catch { /* topic summarization is best-effort */ }
          }
          const { createTempSessionWithOpenCodeSession } = await import("@/lib/tempSessions")
          const result = await createTempSessionWithOpenCodeSession(topic, { title: draft.title, parentID: draft.parentID ?? undefined })
          draftDirectoryOverride = result.path

          if (result.session?.id) {
            const serverSession = result.session as unknown as Session
            const sessionDirectory = (serverSession as { directory?: string }).directory ?? result.path ?? null
            if (sessionDirectory) {
              registerSessionDirectory(serverSession.id, sessionDirectory)
            }
            useGlobalSessionsStore.getState().upsertSession(serverSession)
            const createdDirectory = normalizePath(sessionDirectory)

            const configState = useConfigStore.getState()
            if (configState.currentProviderId && configState.currentModelId) {
              useSelectionStore.getState().saveSessionModelSelection(serverSession.id, configState.currentProviderId, configState.currentModelId)
            }
            const draftAgentName = configState.currentAgentName
            const effectiveDraftAgent = trimmedAgent ?? draftAgentName
            if (effectiveDraftAgent) {
              useSelectionStore.getState().saveSessionAgentSelection(serverSession.id, effectiveDraftAgent)
              if (configState.currentProviderId && configState.currentModelId) {
                useSelectionStore.getState().saveAgentModelForSession(serverSession.id, effectiveDraftAgent, configState.currentProviderId, configState.currentModelId)
                useSelectionStore.getState().saveAgentModelVariantForSession(serverSession.id, effectiveDraftAgent, configState.currentProviderId, configState.currentModelId, variant)
              }
            }
            get().initializeNewOpenChamberSession(serverSession.id, configState.agents ?? [])
            get().markSessionAsOpenChamberCreated(serverSession.id)
            const createdServerId = targetServerId ?? serverRegistry.getServerForSession(serverSession.id)
            if (createdServerId) {
              serverRegistry.indexSession(serverSession.id, createdServerId)
            }
            await migrateDraftPermissionIntentToCreatedSession(serverSession.id, draft)
            await activateConfigForDirectory(createdDirectory, createdServerId)

            notifyMessageSent(serverSession.id, createdDirectory)
            markPendingUserSendAnimation(serverSession.id)

            const files = attachments?.map((a) => ({
              type: "file" as const,
              mime: a.mimeType,
              url: a.dataUrl,
              filename: a.filename,
            }))
            const additionalPartsForSend = draft.syntheticParts?.length
              ? [...(additionalParts || []), ...draft.syntheticParts]
              : additionalParts
            await savePendingMessage({
              sessionId: serverSession.id,
              content,
              providerID,
              modelID,
              agent: effectiveDraftAgent,
              variant,
              inputMode,
              directory: createdDirectory,
              serverId: createdServerId,
              files,
              additionalParts: additionalPartsForSend,
            })
            const routePromise = routeMessage({
              sessionId: serverSession.id,
              content,
              providerID,
              modelID,
              agent: effectiveDraftAgent,
              variant,
              inputMode,
              directory: createdDirectory,
              serverId: createdServerId,
              files,
              additionalParts: additionalPartsForSend,
              deliveryMode,
            })
            if (isLiveDraftStillTarget()) {
              get().closeNewSessionDraft()
              get().setCurrentSession(serverSession.id, createdDirectory, { serverId: createdServerId })
            }
            await routePromise
            await deletePendingMessage(serverSession.id)
            return
          }
        } catch (err) {
          console.warn("[TempSession] Failed to create temp session:", err)
          throw new Error("Failed to create temp session directory")
        }
      }

      let created: Session | null = null
      let createError: unknown = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          created = await get().createSession(draft.title, draftDirectoryOverride, draft.parentID ?? null, targetServerId, {
            select: !isCapturedDraftSend,
          })
        } catch (error) {
          createError = error
        }
        if (created?.id) break
        if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
      }
      if (!created?.id) {
        if (createError !== null) throw createError
        throw new Error("Failed to create session")
      }

      if (!isTempDraft) {
        persistDraftTarget({
          projectId: draftProjectId,
          directory: normalizePath(created.directory ?? draftDirectoryOverride ?? null),
        })
      }

      const draftSyntheticParts = draft.syntheticParts
      const createdServerId = targetServerId ?? serverRegistry.getServerForSession(created.id)
      if (createdServerId) {
        serverRegistry.indexSession(created.id, createdServerId)
      }
      await migrateDraftPermissionIntentToCreatedSession(created.id, draft)
      await activateConfigForDirectory(created.directory ?? draftDirectoryOverride ?? null, createdServerId)

      const configState = useConfigStore.getState()
      const draftAgentName = configState.currentAgentName
      const effectiveDraftAgent = trimmedAgent ?? draftAgentName

      if (configState.currentProviderId && configState.currentModelId) {
        useSelectionStore.getState().saveSessionModelSelection(created.id, configState.currentProviderId, configState.currentModelId)
      }

      if (effectiveDraftAgent) {
        useSelectionStore.getState().saveSessionAgentSelection(created.id, effectiveDraftAgent)
        if (configState.currentProviderId && configState.currentModelId) {
          useSelectionStore.getState().saveAgentModelForSession(created.id, effectiveDraftAgent, configState.currentProviderId, configState.currentModelId)
          useSelectionStore.getState().saveAgentModelVariantForSession(created.id, effectiveDraftAgent, configState.currentProviderId, configState.currentModelId, variant)
        }
      }

      get().initializeNewOpenChamberSession(created.id, configState.agents ?? [])

      const createdDirectory = normalizePath(created.directory ?? draftDirectoryOverride ?? null)

      if (draftTargetFolderId) {
        const scopeKey = created.directory || draftDirectoryOverride || null
        if (scopeKey) {
          useSessionFoldersStore.getState().addSessionToFolder(scopeKey, draftTargetFolderId, created.id)
        }
      }

      const mergedAdditionalParts = draftSyntheticParts?.length
        ? [...(additionalParts || []), ...draftSyntheticParts]
        : additionalParts

      notifyMessageSent(created.id, createdDirectory)

      markPendingUserSendAnimation(created.id)

      const files = attachments?.map((a) => ({
        type: "file" as const,
        mime: a.mimeType,
        url: a.dataUrl,
        filename: a.filename,
      }))

      const routeAdditionalParts = mergedAdditionalParts?.map((p) => ({
        text: p.text,
        synthetic: p.synthetic,
        files: p.attachments?.map((a: AttachedFile) => ({
          type: "file" as const,
          mime: a.mimeType,
          url: a.dataUrl,
          filename: a.filename,
        })),
      }))

      await savePendingMessage({
        sessionId: created.id,
        content,
        providerID,
        modelID,
        agent: effectiveDraftAgent,
        variant,
        inputMode,
        directory: createdDirectory,
        serverId: createdServerId,
        files,
        additionalParts: routeAdditionalParts,
      })
      const routePromise = routeMessage({
        sessionId: created.id,
        content,
        providerID,
        modelID,
        agent: effectiveDraftAgent,
        agentMentionName,
        variant,
        inputMode,
        directory: createdDirectory,
        serverId: createdServerId,
        files,
        additionalParts: routeAdditionalParts,
        deliveryMode,
      })
      if (isLiveDraftStillTarget()) {
        get().closeNewSessionDraft()
        get().setCurrentSession(created.id, createdDirectory, { serverId: createdServerId })
      }
      await routePromise
      await deletePendingMessage(created.id)
      return
    } catch (error) {
      if (isLiveDraftStillTarget()) {
        set({ newSessionDraft: { ...draftSnap, open: true, submitting: false } })
      }
      throw error
    }
    }

    // ---- Existing session ----
    const currentSessionId = targetSessionId ?? get().currentSessionId
    const sessionAgentSelection = currentSessionId
      ? useSelectionStore.getState().getSessionAgentSelection(currentSessionId)
      : null
    const configAgentName = useConfigStore.getState().currentAgentName
    const effectiveAgent = trimmedAgent || sessionAgentSelection || configAgentName || undefined

    if (currentSessionId && effectiveAgent) {
      useSelectionStore.getState().saveSessionAgentSelection(currentSessionId, effectiveAgent)
      useSelectionStore.getState().saveAgentModelVariantForSession(currentSessionId, effectiveAgent, providerID, modelID, variant)
    }

    if (currentSessionId) {
      const viewportState = useViewportStore.getState()
      const memState = viewportState.sessionMemoryState.get(currentSessionId)
      if (!memState || !memState.lastUserMessageAt) {
        const newMemState = new Map(viewportState.sessionMemoryState)
        newMemState.set(currentSessionId, {
          viewportAnchor: 0,
          isStreaming: false,
          lastAccessedAt: Date.now(),
          backgroundMessageCount: 0,
          ...memState,
          lastUserMessageAt: Date.now(),
        })
        useViewportStore.setState({ sessionMemoryState: newMemState })
      }
    }

    const currentSessionDirectory = currentSessionId
      ? targetDirectory ?? normalizePath(get().getDirectoryForSession(currentSessionId))
      : null
    if (!currentSessionId || !currentSessionDirectory) {
      throw new Error("Cannot send message: current session directory is not available")
    }
    const currentSessionServerId = targetServerId ?? serverRegistry.getServerForSession(currentSessionId)
    registerSessionDirectory(currentSessionId, currentSessionDirectory)
    if (currentSessionServerId) {
      serverRegistry.indexSession(currentSessionId, currentSessionServerId)
    }

    notifyMessageSent(currentSessionId, currentSessionDirectory)

    markPendingUserSendAnimation(currentSessionId)

    const files = attachments?.map((a) => ({
      type: "file" as const,
      mime: a.mimeType,
      url: a.dataUrl,
      filename: a.filename,
    }))

    await routeMessage({
      sessionId: currentSessionId,
      content,
      providerID,
      modelID,
      agent: effectiveAgent,
      agentMentionName,
      variant,
      inputMode,
      files,
      directory: currentSessionDirectory,
      serverId: currentSessionServerId,
      deliveryMode,
      additionalParts: additionalParts?.map((p) => ({
        text: p.text,
        synthetic: p.synthetic,
        files: p.attachments?.map((a) => ({
          type: "file" as const,
          mime: a.mimeType,
          url: a.dataUrl,
          filename: a.filename,
        })),
      })),
    })
  },

  // ---------------------------------------------------------------------------
  // createSession
  // ---------------------------------------------------------------------------
  createSession: async (title, directoryOverride, parentID, serverIdOverride, options, metadata) => {
    const draft = get().newSessionDraft
    const targetFolderId = draft.targetFolderId

      if (!directoryOverride) {
        console.error("[session-ui-store] createSession: directoryOverride is required (no global-directory fallback)")
        return null
      }
      const projects = useProjectsStore.getState().projects
      const projectsState = useProjectsStore.getState()
      const directoryProject = resolveProjectForSessionDirectory(
        projects,
        get().availableWorktreesByProject,
        directoryOverride,
      )
      const selectedProject = draft.selectedProjectId
        ? projects.find((p) => p.id === draft.selectedProjectId)
        : null
      const activeProject = projectsState.activeProjectId
        ? projects.find((p) => p.id === projectsState.activeProjectId)
        : null
      const activeDirectoryProject = projectOwnsDirectory(activeProject, get().availableWorktreesByProject, directoryOverride)
        ? activeProject
        : null
      const selectedDirectoryProject = projectOwnsDirectory(selectedProject, get().availableWorktreesByProject, directoryOverride)
        ? selectedProject
        : null
      const routingProject = activeDirectoryProject ?? selectedDirectoryProject ?? directoryProject ?? selectedProject ?? null
      const serverId = normalizeProjectServerId(serverIdOverride ?? routingProject?.serverId)
      const session = await createSessionAction(title, directoryOverride, parentID ?? null, serverId, options, metadata)
      if (!session) return null

      if (targetFolderId) {
        const scopeKey = directoryOverride || get().lastLoadedDirectory || session.directory
        if (scopeKey) {
          useSessionFoldersStore.getState().addSessionToFolder(scopeKey, targetFolderId, session.id)
        }
      }

      return session
  },

  // ---------------------------------------------------------------------------
  // deleteSession — calls SDK, SSE event updates child store
  // ---------------------------------------------------------------------------
  deleteSession: (id) => deleteSessionAction(id),

  deleteSessions: async (ids) => {
    const deletedIds: string[] = []
    const failedIds: string[] = []
    for (const id of ids) {
      const ok = await deleteSessionAction(id)
      if (ok) deletedIds.push(id)
      else failedIds.push(id)
    }
    return { deletedIds, failedIds }
  },

  archiveSession: (id) => archiveSessionAction(id),

  archiveSessions: async (ids) => {
    const archivedIds: string[] = []
    const failedIds: string[] = []
    for (const id of ids) {
      const ok = await archiveSessionAction(id)
      if (ok) archivedIds.push(id)
      else failedIds.push(id)
    }
    return { archivedIds, failedIds }
  },

  // ---------------------------------------------------------------------------
  // updateSessionTitle — calls SDK, SSE event updates child store
  // ---------------------------------------------------------------------------
  updateSessionTitle: async (sessionId, title) => {
    await updateSessionTitleAction(sessionId, title)
  },

  shareSession: async (sessionId) => {
    return shareSessionAction(sessionId)
  },

  unshareSession: async (sessionId) => {
    return unshareSessionAction(sessionId)
  },

  // ---------------------------------------------------------------------------
  // revertToMessage — delegates to session-actions (single implementation)
  // ---------------------------------------------------------------------------
  revertToMessage: async (sessionId, messageId) => {
    await refetchSessionMessages(sessionId)
    const { revertToMessage: revert } = await import("./session-actions")
    await revert(sessionId, messageId)
  },

  // ---------------------------------------------------------------------------
  // handleSlashUndo — reads from sync
  // ---------------------------------------------------------------------------
  handleSlashUndo: async (sessionId) => {
    const directory = get().getDirectoryForSession(sessionId) ?? undefined
    const messages = getSyncMessages(sessionId, directory)
    const sessions = getSyncSessions(directory)
    const currentSession = sessions.find((s) => s.id === sessionId)

    const userMessages = messages.filter((message) => (
      isRealUserMessage(message, getSyncParts(message.id, directory))
    ))
    if (userMessages.length === 0) return

    const revertToId = currentSession?.revert?.messageID
    let targetMessage: typeof messages[number] | undefined
    if (revertToId) {
      targetMessage = [...userMessages].reverse().find((m) => m.id < revertToId)
    } else {
      targetMessage = userMessages[userMessages.length - 1]
    }

    if (!targetMessage) return

    const targetParts = getSyncParts(targetMessage.id, directory)
    const textPart = targetParts.find((p: Part) => p.type === "text") as TextPart | undefined
    const preview = textPart?.text
      ? String(textPart.text).slice(0, 50) + (textPart.text.length > 50 ? "..." : "")
      : "[No text]"

    await get().revertToMessage(sessionId, targetMessage.id)

    const { toast } = await import("sonner")
    const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
    const { dictionary } = useI18nStore.getState()
    toast.success(formatMessage(dictionary, "chat.revert.toast.undo", { preview }))
  },

  // ---------------------------------------------------------------------------
  // handleSlashRedo — reads from sync
  // ---------------------------------------------------------------------------
  handleSlashRedo: async (sessionId, options) => {
    if (options?.fullUnrevert) {
      const { unrevertSession } = await import("./session-actions")
      await unrevertSession(sessionId)
      const { toast } = await import("sonner")
      const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
      const { dictionary } = useI18nStore.getState()
      toast.success(formatMessage(dictionary, "chat.revert.toast.restored"))
      return
    }

    const directory = get().getDirectoryForSession(sessionId) ?? undefined
    const sessions = getSyncSessions(directory)
    const currentSession = sessions.find((s) => s.id === sessionId)
    const revertToId = currentSession?.revert?.messageID
    if (!revertToId) return

    await refetchSessionMessages(sessionId)
    const messages = getSyncMessages(sessionId, directory)
    const userMessages = messages.filter((message) => (
      isRealUserMessage(message, getSyncParts(message.id, directory))
    ))
    const targetMessage = userMessages.find((m) => m.id > revertToId)

    if (targetMessage) {
      await get().revertToMessage(sessionId, targetMessage.id)
      const { toast } = await import("sonner")
      const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
      const { dictionary } = useI18nStore.getState()
      toast.success(formatMessage(dictionary, "chat.revert.toast.redo"))
      return
    }

    const { unrevertSession } = await import("./session-actions")
    await unrevertSession(sessionId)
    const { toast } = await import("sonner")
    const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
    const { dictionary } = useI18nStore.getState()
    toast.success(formatMessage(dictionary, "chat.revert.toast.restored"))
  },

  // ---------------------------------------------------------------------------
  // handleSlashCompact — runs /compact locally (not via server command dispatch).
  // Mirrors the inline logic that used to live in ChatInput.handleSubmit so that
  // both direct input and queued auto-send invoke the same compaction path.
  // ---------------------------------------------------------------------------
  handleSlashCompact: async (content, sessionId) => {
    try {
      const { waitForConnectionOrThrow } = await import("./session-actions")
      await waitForConnectionOrThrow(serverRegistry.getServerForSession(sessionId))

      const { parseSlashInvocation } = await import("./slash-routing")
      const invocation = parseSlashInvocation(content)
      const focusText = invocation?.arguments?.trim() ?? ""

      if (focusText) {
        try {
          await fetch("/api/compact-focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionID: sessionId, focus: focusText }),
          })
          const { toast } = await import("sonner")
          const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
          const { dictionary } = useI18nStore.getState()
          toast.info(formatMessage(dictionary, "chat.chatInput.toast.compactWithFocus", { focus: focusText }))
        } catch {
          // Focus injection is best-effort; proceed with plain compaction
        }
      }

      const { opencodeClient } = await import("@/lib/opencode/client")
      const sdk = opencodeClient.getSdkClient()
      const { useConfigStore } = await import("@/stores/useConfigStore")
      const configState = useConfigStore.getState()
      await sdk.session.summarize({
        sessionID: sessionId,
        modelID: configState.currentModelId || "",
        providerID: configState.currentProviderId || "",
      })
    } catch (error) {
      const { toast } = await import("sonner")
      const { useI18nStore, formatMessage } = await import("@/lib/i18n/store")
      const { dictionary } = useI18nStore.getState()
      toast.error(error instanceof Error ? error.message : formatMessage(dictionary, "chat.chatInput.toast.compactFailed"))
    }
  },

  // ---------------------------------------------------------------------------
  // tryDispatchLocalSlashCommand — returns true if a local slash command was
  // handled (so callers can skip generic sendMessage). Used by both
  // ChatInput.handleSubmit (direct input) and useQueuedMessageAutoSend (queue flush)
  // so direct and queued invocations behave identically.
  // ---------------------------------------------------------------------------
  tryDispatchLocalSlashCommand: async (content, sessionId) => {
    const trimmed = content.trimStart()
    if (!trimmed.startsWith("/")) return false

    const commandName = trimmed
      .slice(1)
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()

    if (!commandName) return false

    if (commandName === "undo") {
      await get().handleSlashUndo(sessionId)
      return true
    }
    if (commandName === "redo") {
      await get().handleSlashRedo(sessionId)
      return true
    }
    if (commandName === "compact") {
      await get().handleSlashCompact(content, sessionId)
      return true
    }

    return false
  },

  // ---------------------------------------------------------------------------
  // forkFromMessage — delegates to session-actions (handles text + sidebar)
  // ---------------------------------------------------------------------------
  forkFromMessage: async (sessionId, messageId) => {
    const sessions = getSyncSessions()
    const existingSession = sessions.find((s) => s.id === sessionId)
    if (!existingSession) return

    try {
      const { forkFromMessage: fork } = await import("./session-actions")
      await fork(sessionId, messageId)

      const { toast } = await import("sonner")
      toast.success(`Forked from ${existingSession.title}`)
    } catch (error) {
      console.error("Failed to fork session:", error)
      const { toast } = await import("sonner")
      toast.error("Failed to fork session")
    }
  },

  // ---------------------------------------------------------------------------
  // createSessionFromAssistantMessage — reads from sync
  // ---------------------------------------------------------------------------
  createSessionFromAssistantMessage: async (sourceMessageId, execution) => {
    if (!sourceMessageId) return
    if (!execution?.instructions?.trim()) return

    // Find which session this message belongs to by scanning sync state
    const state = getDirectoryState()
    if (!state) return

    let sourceSessionId: string | undefined
    let sourceMessage: Message | undefined

    for (const [sid, msgs] of Object.entries(state.message ?? {})) {
      const found = msgs.find((m) => m.id === sourceMessageId)
      if (found) {
        sourceSessionId = sid
        sourceMessage = found
        break
      }
    }

    if (!sourceMessage || sourceMessage.role !== "assistant") return

    const sourceParts = getSyncParts(sourceMessageId)
    const assistantPlanText = flattenAssistantTextParts(sourceParts)
    if (!assistantPlanText.trim()) return

    const directory = resolveSessionDirectory(
      sourceSessionId ?? null,
      (sid) => get().worktreeMetadata.get(sid),
    )

    if (!directory) {
      console.error(
        "[session-ui-store] createSessionFromAssistantMessage: source session directory unknown",
        { sourceSessionId, sourceMessageId },
      )
      return
    }

    const session = await get().createSession(undefined, directory, null)
    if (!session) return

    const pID = execution.providerID || useSelectionStore.getState().lastUsedProvider?.providerID
    const mID = execution.modelID || useSelectionStore.getState().lastUsedProvider?.modelID

    if (!pID || !mID) return

    const sessionDirectory = normalizePath((session as { directory?: string | null }).directory ?? directory)
    const sessionServerId = serverRegistry.getServerForSession(session.id)
    await opencodeClient.sendMessage({
      id: session.id,
      providerID: pID,
      modelID: mID,
      variant: execution.variant || undefined,
      text: composeForkSessionMessage(execution.instructions, assistantPlanText),
      agent: execution.agent || undefined,
      directory: sessionDirectory,
      serverId: sessionServerId,
    })
  },

  // ---------------------------------------------------------------------------
  // Data access helpers — read from sync
  // ---------------------------------------------------------------------------
  getSessionsByDirectory: (directory) => {
    const nd = normalizePath(directory)
    if (!nd) return []
    const sessions = getAllSyncSessions()
    return sessions.filter((s) => resolveDirectoryKey(s) === nd)
  },

  getDirectoryForSession: (sessionId) => {
    const attachmentDirectory = getAttachedSessionDirectory(getAttachmentForSession(sessionId))
    if (attachmentDirectory) return attachmentDirectory

    const metaPath = get().worktreeMetadata.get(sessionId)?.path
    if (typeof metaPath === "string" && metaPath.trim().length > 0) return normalizePath(metaPath)

    const sessions = getAllSyncSessions()
    const session = sessions.find((s) => s.id === sessionId)
    if (session) return resolveDirectoryKey(session)

    const globalState = useGlobalSessionsStore.getState()
    const globalSession =
      globalState.activeSessions.find((s) => s.id === sessionId) ??
      globalState.archivedSessions.find((s) => s.id === sessionId)
    if (globalSession) return resolveGlobalSessionDirectory(globalSession)

    const routingDir = getSessionDirectoryFromRoutingIndex(sessionId)
    if (routingDir) return normalizePath(routingDir)

    return null
  },

  getLastUserChoice: (sessionId) => {
    const directory = get().getDirectoryForSession(sessionId) ?? undefined
    const directoryState = getDirectoryState(directory)
    const message = findLatestRealUserMessage(
      directoryState?.message[sessionId] ?? [],
      directoryState?.part ?? {},
    ) as (Message & {
        model?: { providerID?: string; modelID?: string; variant?: string }
        variant?: string
        mode?: string
      }) | undefined
    if (!message) return null

    const providerID = typeof message.model?.providerID === "string" && message.model.providerID.trim().length > 0
      ? message.model.providerID
      : undefined
    const modelID = typeof message.model?.modelID === "string" && message.model.modelID.trim().length > 0
      ? message.model.modelID
      : undefined
    const agent = typeof message.agent === "string" && message.agent.trim().length > 0
      ? message.agent
      : (typeof message.mode === "string" && message.mode.trim().length > 0 ? message.mode : undefined)
    const variantCandidate = message.model?.variant ?? message.variant
    const variant = typeof variantCandidate === "string" && variantCandidate.trim().length > 0
      ? variantCandidate
      : undefined

    return { agent, providerID, modelID, variant }
  },

  getCurrentAgent: (sessionId) => {
    return useSelectionStore.getState().sessionAgentSelections.get(sessionId) ?? undefined
  },

  debugSessionMessages: async (sessionId) => {
    const msgs = getSyncMessages(sessionId)
    const sessions = getSyncSessions()
    const session = sessions.find((s) => s.id === sessionId)
    console.log(`Debug session ${sessionId}:`, {
      session,
      messageCount: msgs.length,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        tokens: m.role === "assistant" ? m.tokens : undefined,
      })),
    })
  },

  pollForTokenUpdates: () => {
    // Handled by sync system's SSE stream
  },

  setSessionDirectory: () => {
    // Session directory is owned by sync child stores via SSE events.
    // This is now a no-op — kept for interface compatibility during migration.
  },

  // ---------------------------------------------------------------------------
  // Plan mode availability tracking
  // ---------------------------------------------------------------------------
  markSessionPlanAvailable: (sessionId) => {
    set((state) => {
      if (state.sessionPlanAvailable.get(sessionId) === true) {
        return state
      }
      const next = new Map(state.sessionPlanAvailable)
      next.set(sessionId, true)
      return { sessionPlanAvailable: next }
    })
  },

  isSessionPlanAvailable: (sessionId) => {
    return get().sessionPlanAvailable.get(sessionId) ?? false
  },
}))

setSessionRoutingContextGetters({
  getProjects: () => useProjectsStore.getState().projects,
  getAvailableWorktreesByProject: () => useSessionUIStore.getState().availableWorktreesByProject,
})
