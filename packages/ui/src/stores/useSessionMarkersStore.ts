// ---------------------------------------------------------------------------
// Session markers store — per-session user-defined status, todos, priority.
//
// Tracks per-session markers (status, todos, important) as a side-channel
// alongside the SDK Session type. Mirrors the notification-store pattern
// (notification-store.ts) for hydration, SSE application, and optimistic
// updates.
//
// Uses Map<string, SessionMarkers> for O(1) lookups. Referential equality
// is preserved per AGENTS.md performance rules: only the affected entry's
// reference changes on update.
// ---------------------------------------------------------------------------

import { create } from "zustand"

import type {
  SessionMarkers,
  SessionMarkersPatch,
  SessionStatusMarker,
  SessionTodoMarker,
} from "./types/sessionMarkers"
import { MAX_TODO_MARKERS } from "./types/sessionMarkers"

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const VALID_STATUS_VALUES: ReadonlySet<string> = new Set([
  "draft",
  "in-progress",
  "done",
  "blocked",
  "archived",
])

const VALID_TODO_VALUES: ReadonlySet<string> = new Set([
  "uncommitted",
  "untested",
  "needs-review",
])

function isSessionStatusMarker(value: unknown): value is SessionStatusMarker {
  return typeof value === "string" && VALID_STATUS_VALUES.has(value)
}

function isSessionTodoMarker(value: unknown): value is SessionTodoMarker {
  return typeof value === "string" && VALID_TODO_VALUES.has(value)
}

/**
 * Validate that a value from the server has the correct SessionMarkers shape.
 * `todos` is required on the type but may be absent in server payloads; we
 * default to an empty array so the store invariant holds.
 */
function isSessionMarkers(value: unknown): value is SessionMarkers {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.status !== undefined && !isSessionStatusMarker(record.status)) return false
  if (record.important !== undefined && typeof record.important !== "boolean") return false
  if (!Array.isArray(record.todos)) return false
  for (const todo of record.todos) {
    if (!isSessionTodoMarker(todo)) return false
  }
  return true
}

/**
 * Validate and normalize a server-sourced markers value into a typed
 * `SessionMarkers` object. Returns `null` if the shape is invalid.
 * Exported so the SSE normalizer can type-narrow before calling
 * `applyServerUpdate` without resorting to `as` casts.
 */
export function normalizeSessionMarkers(value: unknown): SessionMarkers | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const todos: SessionTodoMarker[] = []
  if (Array.isArray(record.todos)) {
    for (const todo of record.todos) {
      if (isSessionTodoMarker(todo)) todos.push(todo)
    }
  }
  const result: SessionMarkers = { todos }
  if (isSessionStatusMarker(record.status)) {
    result.status = record.status
  }
  if (typeof record.important === "boolean") {
    result.important = record.important
  }
  return result
}

function areMarkersEqual(a: SessionMarkers, b: SessionMarkers): boolean {
  if (a.status !== b.status) return false
  if (a.important !== b.important) return false
  if (a.todos.length !== b.todos.length) return false
  for (let i = 0; i < a.todos.length; i++) {
    if (a.todos[i] !== b.todos[i]) return false
  }
  return true
}

/**
 * Apply a patch to existing markers, producing the next full markers object.
 *
 * Patch semantics (per sessionMarkers.ts contract):
 * - status: undefined = keep, null = delete, string = set
 * - important: undefined = keep, null = delete, boolean = set
 * - todos: undefined = keep, array = replace + dedupe + slice(MAX_TODO_MARKERS)
 */
function applyPatch(current: SessionMarkers | undefined, patch: SessionMarkersPatch): SessionMarkers {
  const next: SessionMarkers = {
    ...(current?.status !== undefined ? { status: current.status } : {}),
    todos: current ? [...current.todos] : [],
    ...(current?.important !== undefined ? { important: current.important } : {}),
  }

  if (patch.status === null) {
    delete next.status
  } else if (patch.status !== undefined) {
    next.status = patch.status
  }

  if (patch.important === null) {
    delete next.important
  } else if (patch.important !== undefined) {
    next.important = patch.important
  }

  if (patch.todos !== undefined) {
    const seen = new Set<SessionTodoMarker>()
    const deduped: SessionTodoMarker[] = []
    for (const todo of patch.todos) {
      if (!seen.has(todo)) {
        seen.add(todo)
        deduped.push(todo)
      }
    }
    next.todos = deduped.slice(0, MAX_TODO_MARKERS)
  }

  return next
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface SessionMarkersStore {
  markers: Map<string, SessionMarkers>

  /** Bulk replace on bootstrap hydrate. */
  hydrateFromServer: (data: { sessions: Record<string, SessionMarkers> }) => void

  /**
   * Apply a server-sourced update (from SSE). `null` means the session's
   * markers were cleared.
   */
  applyServerUpdate: (sessionId: string, markers: SessionMarkers | null) => void

  /** Optimistic update + API call (fire-and-forget reconcile). */
  setMarker: (sessionId: string, patch: SessionMarkersPatch) => Promise<void>

  /** Optimistic clear + API call. */
  clearMarker: (sessionId: string) => Promise<void>

  /** Local cleanup only (no API call) — used on session.deleted. */
  clearAllForSession: (sessionId: string) => void
}

export const useSessionMarkersStore = create<SessionMarkersStore>((set, get) => ({
  markers: new Map<string, SessionMarkers>(),

  hydrateFromServer: (data) => {
    const next = new Map<string, SessionMarkers>()
    for (const [id, raw] of Object.entries(data.sessions)) {
      const markers = normalizeSessionMarkers(raw)
      if (markers) {
        next.set(id, markers)
      }
    }
    set({ markers: next })
  },

  applyServerUpdate: (sessionId, markers) => {
    if (!sessionId) return
    const prev = get().markers

    if (markers === null) {
      if (!prev.has(sessionId)) return
      const next = new Map(prev)
      next.delete(sessionId)
      set({ markers: next })
      return
    }

    const normalized = normalizeSessionMarkers(markers)
    if (!normalized) return

    const existing = prev.get(sessionId)
    if (existing && areMarkersEqual(existing, normalized)) return

    const next = new Map(prev)
    next.set(sessionId, normalized)
    set({ markers: next })
  },

  setMarker: async (sessionId, patch) => {
    if (!sessionId) return
    const prev = get().markers
    const prevMarkers = prev.get(sessionId)

    // --- Optimistic update ---
    const optimistic = applyPatch(prevMarkers, patch)
    const optimisticMap = new Map(prev)
    optimisticMap.set(sessionId, optimistic)
    set({ markers: optimisticMap })

    try {
      const response = await fetch(
        `/api/openchamber/sessions/${encodeURIComponent(sessionId)}/markers`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(patch),
        },
      )
      if (!response.ok) {
        throw new Error(`setSessionMarkers failed: ${response.status}`)
      }
      const data = (await response.json()) as { sessionId?: string; markers?: unknown }
      // --- Reconcile with server-returned markers ---
      // Only replace if our optimistic entry is still the current one
      // (an SSE event may have superseded it — SSE wins).
      const current = get().markers
      if (current.get(sessionId) === optimistic && data.markers) {
        const serverMarkers = normalizeSessionMarkers(data.markers)
        if (serverMarkers) {
          const next = new Map(current)
          next.set(sessionId, serverMarkers)
          set({ markers: next })
        }
      }
    } catch (error) {
      // --- Rollback ---
      const current = get().markers
      if (current.get(sessionId) === optimistic) {
        const next = new Map(current)
        if (prevMarkers) {
          next.set(sessionId, prevMarkers)
        } else {
          next.delete(sessionId)
        }
        set({ markers: next })
      }
      throw error
    }
  },

  clearMarker: async (sessionId) => {
    if (!sessionId) return
    const prev = get().markers
    const prevMarkers = prev.get(sessionId)
    if (!prevMarkers) return

    // --- Optimistic clear ---
    const optimisticMap = new Map(prev)
    optimisticMap.delete(sessionId)
    set({ markers: optimisticMap })

    try {
      const response = await fetch(
        `/api/openchamber/sessions/${encodeURIComponent(sessionId)}/markers`,
        { method: "DELETE", headers: { accept: "application/json" } },
      )
      if (!response.ok) {
        throw new Error(`clearSessionMarkers failed: ${response.status}`)
      }
    } catch (error) {
      // --- Rollback ---
      const current = get().markers
      if (!current.has(sessionId)) {
        const next = new Map(current)
        next.set(sessionId, prevMarkers)
        set({ markers: next })
      }
      throw error
    }
  },

  clearAllForSession: (sessionId) => {
    if (!sessionId) return
    const prev = get().markers
    if (!prev.has(sessionId)) return
    const next = new Map(prev)
    next.delete(sessionId)
    set({ markers: next })
  },
}))

// ---------------------------------------------------------------------------
// Leaf selector hook — subscribes to a single entry, NOT the whole Map.
// Per AGENTS.md: "Select leaf values, not containers."
// ---------------------------------------------------------------------------

export function useSessionMarker(sessionId: string): SessionMarkers | undefined {
  return useSessionMarkersStore((s) => s.markers.get(sessionId))
}

// ---------------------------------------------------------------------------
// Server-backed hydration.
//
// THROWS on fetch failure so callers can distinguish a transient network
// error from an empty-but-successful response (AGENTS.md: "distinguish fetch
// failure from empty success"). The bootstrap caller catches and proceeds
// without markers.
// ---------------------------------------------------------------------------

export async function fetchAndHydrateMarkersState(): Promise<void> {
  const res = await fetch("/api/openchamber/sessions/markers", {
    method: "GET",
    headers: { accept: "application/json" },
  })
  if (!res.ok) {
    throw new Error(`fetchAndHydrateMarkersState: HTTP ${res.status}`)
  }
  const data = (await res.json()) as { sessions?: Record<string, unknown> }
  const sessions = data?.sessions
  if (!sessions || typeof sessions !== "object") {
    // Empty success — hydrate with empty Map.
    useSessionMarkersStore.getState().hydrateFromServer({ sessions: {} })
    return
  }
  useSessionMarkersStore.getState().hydrateFromServer({
    sessions: sessions as Record<string, SessionMarkers>,
  })
}

/**
 * Apply an SSE event payload for session markers.
 * Payload shape: { sessionId, markers: SessionMarkers | null }
 */
export function applyMarkersEventPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return
  const record = payload as { sessionId?: unknown; sessionID?: unknown; markers?: unknown }
  const sessionId = typeof record.sessionId === "string" && record.sessionId.length > 0
    ? record.sessionId
    : typeof record.sessionID === "string" && record.sessionID.length > 0
      ? record.sessionID
      : ""
  if (!sessionId) return
  const rawMarkers = record.markers
  if (rawMarkers === null) {
    useSessionMarkersStore.getState().applyServerUpdate(sessionId, null)
    return
  }
  if (!isSessionMarkers(rawMarkers)) return
  useSessionMarkersStore.getState().applyServerUpdate(sessionId, rawMarkers)
}
