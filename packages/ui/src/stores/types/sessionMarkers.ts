/**
 * Per-session user-defined markers (status, todos, priority).
 *
 * Stored as a side-channel alongside (NOT inside) the SDK `Session` type,
 * because the Session type is owned by @opencode-ai/sdk and cannot be
 * extended from OpenChamber (AGENTS.md: do not modify ../opencode).
 *
 * Persisted server-side at `<openchamberDataDir>/session-markers.json`
 * and broadcast to clients via `openchamber:session-markers` SSE events.
 * The pattern mirrors `session-unread-store.js` + `notification-store.ts`.
 */

/** Single-select main status (lifecycle stage). `undefined` = no status set. */
export type SessionStatusMarker =
  | 'draft' // ri-draft-line: idea / preliminary discussion
  | 'in-progress' // ri-tools-line: actively being worked on
  | 'done' // ri-checkbox-circle-line: work completed
  | 'blocked' // ri-forbid-line: stuck / waiting on external dependency
  | 'archived'; // ri-archive-line: no longer active, kept for reference

/** Multi-select todo markers (pending wrap-up items). Max 2 enforced. */
export type SessionTodoMarker =
  | 'uncommitted' // ri-git-commit-line: code changes not yet committed
  | 'untested' // ri-bug-line OR ri-flask-line (toggle via UNTESTED_ICON below): not yet tested
  | 'needs-review'; // ri-eye-line: needs another pass

/** Priority marker (single, optional). */
export type SessionPriorityMarker = 'important'; // ri-fire-line

/** Full marker state for a session. */
export interface SessionMarkers {
  status?: SessionStatusMarker;
  todos: SessionTodoMarker[];
  important?: boolean;
}

/**
 * Patch payload for partial updates. Field semantics:
 * - `undefined`: leave unchanged
 * - `null` (for status/important): clear the field
 * - array/value: replace
 */
export interface SessionMarkersPatch {
  status?: SessionStatusMarker | null;
  todos?: SessionTodoMarker[];
  important?: boolean | null;
}

/** Maximum number of todo markers per session (UI enforces this). */
export const MAX_TODO_MARKERS = 2;

/** All valid status marker values, in menu display order. */
export const STATUS_MARKER_VALUES: SessionStatusMarker[] = [
  'draft',
  'in-progress',
  'done',
  'blocked',
  'archived',
];

/** All valid todo marker values, in menu display order. */
export const TODO_MARKER_VALUES: SessionTodoMarker[] = [
  'uncommitted',
  'untested',
  'needs-review',
];

/**
 * Icon for the "untested" todo marker. User is evaluating both options.
 * Flip this single constant to switch between bug and flask app-wide.
 * Valid values: 'bug' (ri-bug-line, higher recognition) | 'flask' (ri-flask-line, more accurate)
 */
export const UNTESTED_ICON = 'bug' as const;

/**
 * Server API contract (mirrors the unread-state endpoints):
 *
 * GET /api/openchamber/sessions/markers
 *   Response: { version: number, sessions: Record<sessionId, SessionMarkers> }
 *
 * PUT /api/openchamber/sessions/:sessionId/markers
 *   Body: SessionMarkersPatch
 *   Response: { sessionId, markers: SessionMarkers }   // full markers after patch
 *
 * DELETE /api/openchamber/sessions/:sessionId/markers
 *   Response: { sessionId, cleared: true }
 *
 * SSE event: `openchamber:session-markers`
 *   Payload: { sessionId, markers: SessionMarkers | null }   // null = cleared
 */
