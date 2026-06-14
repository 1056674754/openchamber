// ---------------------------------------------------------------------------
// Notification store — session turn-complete and error tracking
//
// Tracks session turn-complete and error notifications with viewed/unviewed
// state. Replaces the old sessionAttentionStates polling system.
// ---------------------------------------------------------------------------

import { create } from "zustand"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NotificationBase = {
  directory?: string
  session?: string
  time: number
  viewed: boolean
}

type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

type ErrorNotification = NotificationBase & {
  type: "error"
  error?: { message?: string; code?: string }
}

export type Notification = TurnCompleteNotification | ErrorNotification

type NotificationIndex = {
  totalUnseenCount: number
  session: {
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

type SessionUnreadState = {
  unread: boolean
  hasError: boolean
}

type SessionUnreadResponse = {
  sessions?: Record<string, SessionUnreadState>
  state?: SessionUnreadState | null
  sessionId?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NOTIFICATIONS = 500
const NOTIFICATION_TTL_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pruneNotifications(list: Notification[]): Notification[] {
  const cutoff = Date.now() - NOTIFICATION_TTL_MS
  const pruned = list.filter((n) => n.time >= cutoff)
  if (pruned.length <= MAX_NOTIFICATIONS) return pruned
  return pruned.slice(pruned.length - MAX_NOTIFICATIONS)
}

function buildIndex(list: Notification[]): NotificationIndex {
  const index: NotificationIndex = {
    totalUnseenCount: 0,
    session: { unseenCount: {}, unseenHasError: {} },
    project: { unseenCount: {}, unseenHasError: {} },
  }

  for (const n of list) {
    if (n.viewed) continue

    if (n.session) {
      index.session.unseenCount[n.session] = (index.session.unseenCount[n.session] ?? 0) + 1
      index.totalUnseenCount += 1
      if (n.type === "error") index.session.unseenHasError[n.session] = true
    }
    if (n.directory) {
      index.project.unseenCount[n.directory] = (index.project.unseenCount[n.directory] ?? 0) + 1
      if (n.type === "error") index.project.unseenHasError[n.directory] = true
    }
  }

  return index
}

function countUnseenSessions(unseenCount: Record<string, number>): number {
  return Object.values(unseenCount).reduce((total, count) => total + count, 0)
}

function buildSessionIndexFromServer(data: Record<string, SessionUnreadState>): Pick<NotificationIndex, "totalUnseenCount" | "session"> {
  const unseenCount: Record<string, number> = {}
  const unseenHasError: Record<string, boolean> = {}
  for (const [id, state] of Object.entries(data)) {
    if (state.unread) {
      unseenCount[id] = 1
      if (state.hasError) unseenHasError[id] = true
    }
  }
  return {
    totalUnseenCount: countUnseenSessions(unseenCount),
    session: { unseenCount, unseenHasError },
  }
}

function isSessionUnreadState(value: unknown): value is SessionUnreadState {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as { unread?: unknown }).unread === "boolean"
    && typeof (value as { hasError?: unknown }).hasError === "boolean"
}

function parseUnreadResponse(value: unknown): SessionUnreadResponse | null {
  if (!value || typeof value !== "object") return null
  const record = value as { sessions?: unknown; state?: unknown; sessionId?: unknown }
  const result: SessionUnreadResponse = {}

  if (record.sessions && typeof record.sessions === "object") {
    const sessions: Record<string, SessionUnreadState> = {}
    for (const [id, state] of Object.entries(record.sessions)) {
      if (isSessionUnreadState(state)) {
        sessions[id] = state
      }
    }
    result.sessions = sessions
  }

  if (isSessionUnreadState(record.state)) {
    result.state = record.state
  } else if (record.state === null) {
    result.state = null
  }

  if (typeof record.sessionId === "string" && record.sessionId.length > 0) {
    result.sessionId = record.sessionId
  }

  return result
}

async function postSessionUnreadState(sessionId: string, unread: boolean): Promise<SessionUnreadResponse | null> {
  const action = unread ? "unread" : "read"
  const response = await fetch(`/api/openchamber/sessions/${encodeURIComponent(sessionId)}/${action}`, { method: "POST" })
  if (!response.ok) {
    return null
  }
  return parseUnreadResponse(await response.json())
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface NotificationStore {
  list: Notification[]
  index: NotificationIndex

  // Mutations
  append: (notification: Notification) => void
  markSessionViewed: (sessionId: string) => void
  markProjectViewed: (directory: string) => void
  hydrateFromServer: (data: Record<string, { unread: boolean; hasError: boolean }>) => void

  // Selectors
  sessionUnseenCount: (sessionId: string) => number
  sessionHasError: (sessionId: string) => boolean
  projectUnseenCount: (directory: string) => number
  projectHasError: (directory: string) => boolean
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  list: [],
  index: {
    totalUnseenCount: 0,
    session: { unseenCount: {}, unseenHasError: {} },
    project: { unseenCount: {}, unseenHasError: {} },
  },

  append: (notification) => {
    const current = get()
    const next = pruneNotifications([...current.list, notification])
    const newIndex = buildIndex(next)
    // Merge with existing hydrated index (server-sourced entries not in list)
    const mergedSessionCount = { ...current.index.session.unseenCount }
    const mergedSessionErrors = { ...current.index.session.unseenHasError }
    for (const [id, count] of Object.entries(newIndex.session.unseenCount)) {
      mergedSessionCount[id] = count
    }
    for (const [id, val] of Object.entries(newIndex.session.unseenHasError)) {
      mergedSessionErrors[id] = val
    }
    const totalUnseenCount = countUnseenSessions(mergedSessionCount)
    set({
      list: next,
      index: {
        totalUnseenCount,
        session: { unseenCount: mergedSessionCount, unseenHasError: mergedSessionErrors },
        project: newIndex.project,
      },
    })
  },

  markSessionViewed: (sessionId) => {
    const current = get()
    const count = current.index.session.unseenCount[sessionId] ?? 0
    if (count === 0) return

    const next = current.list.map((n) =>
      n.session === sessionId && !n.viewed ? { ...n, viewed: true } : n,
    )
    const newUnseenCount = { ...current.index.session.unseenCount }
    const newUnseenHasError = { ...current.index.session.unseenHasError }
    delete newUnseenCount[sessionId]
    delete newUnseenHasError[sessionId]
    set({
      list: next,
      index: {
        ...current.index,
        totalUnseenCount: countUnseenSessions(newUnseenCount),
        session: { unseenCount: newUnseenCount, unseenHasError: newUnseenHasError },
      },
    })
    postSessionUnreadState(sessionId, false).then((response) => {
      if (response) applyUnreadResponse(response)
    }).catch(() => {
      void fetchAndHydrateUnreadState()
    })
  },

  markProjectViewed: (directory) => {
    const current = get()
    const count = current.index.project.unseenCount[directory] ?? 0
    if (count === 0) return

    const next = current.list.map((n) =>
      n.directory === directory && !n.viewed ? { ...n, viewed: true } : n,
    )
    set({ list: next, index: buildIndex(next) })
  },

  sessionUnseenCount: (sessionId) => get().index.session.unseenCount[sessionId] ?? 0,
  sessionHasError: (sessionId) => get().index.session.unseenHasError[sessionId] ?? false,
  projectUnseenCount: (directory) => get().index.project.unseenCount[directory] ?? 0,
  projectHasError: (directory) => get().index.project.unseenHasError[directory] ?? false,

  hydrateFromServer: (data) => {
    const sessionIndex = buildSessionIndexFromServer(data)
    set({
      list: [],
      index: {
        totalUnseenCount: sessionIndex.totalUnseenCount,
        session: sessionIndex.session,
        project: { unseenCount: {}, unseenHasError: {} },
      },
    })
  },
}))

// ---------------------------------------------------------------------------
// Imperative API for non-React code (event handler in sync-context)
// ---------------------------------------------------------------------------

export function appendNotification(notification: Notification) {
  useNotificationStore.getState().append(notification)
}

export function markSessionViewed(sessionId: string) {
  useNotificationStore.getState().markSessionViewed(sessionId)
}

export async function markSessionUnread(sessionId: string): Promise<boolean> {
  const response = await postSessionUnreadState(sessionId, true)
  if (!response) return false
  applyUnreadResponse(response)
  return true
}

// ---------------------------------------------------------------------------
// React hooks for fine-grained subscriptions
// ---------------------------------------------------------------------------

export function useSessionUnseenCount(sessionId: string): number {
  return useNotificationStore((s) => s.index.session.unseenCount[sessionId] ?? 0)
}

export function useSessionHasError(sessionId: string): boolean {
  return useNotificationStore((s) => s.index.session.unseenHasError[sessionId] ?? false)
}

export function useProjectUnseenCount(directory: string): number {
  return useNotificationStore((s) => s.index.project.unseenCount[directory] ?? 0)
}

export function useTotalUnseenCount(): number {
  return useNotificationStore((s) => s.index.totalUnseenCount)
}

// ---------------------------------------------------------------------------
// Server-backed hydration
// ---------------------------------------------------------------------------

export async function fetchAndHydrateUnreadState() {
  try {
    const res = await fetch("/api/openchamber/sessions/unread")
    if (!res.ok) return
    const data = await res.json()
    const parsed = parseUnreadResponse(data)
    if (parsed?.sessions) {
      useNotificationStore.getState().hydrateFromServer(parsed.sessions)
    }
  } catch {
    return
  }
}

export function updateSessionUnread(sessionId: string, unread: boolean, hasError: boolean) {
  const store = useNotificationStore.getState()
  const newCount = { ...store.index.session.unseenCount }
  const newErrors = { ...store.index.session.unseenHasError }
  if (unread) {
    newCount[sessionId] = 1
    if (hasError) newErrors[sessionId] = true
  } else {
    delete newCount[sessionId]
    delete newErrors[sessionId]
  }
  useNotificationStore.setState({
    index: {
      ...store.index,
      totalUnseenCount: countUnseenSessions(newCount),
      session: { unseenCount: newCount, unseenHasError: newErrors },
    },
  })
}

export function applyUnreadResponse(response: SessionUnreadResponse): void {
  if (response.sessions) {
    useNotificationStore.getState().hydrateFromServer(response.sessions)
    return
  }
  if (!response.sessionId || response.state === undefined) {
    return
  }
  updateSessionUnread(response.sessionId, response.state?.unread === true, response.state?.hasError === true)
}

export function applyUnreadEventPayload(payload: unknown): void {
  const parsed = parseUnreadResponse(payload)
  if (!parsed) return
  applyUnreadResponse(parsed)
}
