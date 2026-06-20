/**
 * @file Per-session user-defined markers (status, todos, important).
 *
 * Server-side SQLite-backed store. Mirrors the structure of
 * `session-unread-store.js`: a factory returning a store object that owns an
 * in-memory map plus an atomic on-disk persistence layer.
 *
 * The persisted DB lives at `<dataDir>/openchamber-sessions.db` and uses a
 * single `session_markers` table. The in-memory shape mirrors what the JSON
 * version exposed:
 *   { version: 1, sessions: { [sessionId]: { status?, todos: [], important? } } }
 *
 * Types mirror `packages/ui/src/stores/types/sessionMarkers.ts` (read-only
 * contract; the server is plain JS).
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Single-select main status (lifecycle stage).
 * @typedef {'draft'|'in-progress'|'done'|'blocked'|'archived'} SessionStatusMarker
 */

/**
 * Multi-select todo marker (pending wrap-up item).
 * @typedef {'uncommitted'|'untested'|'needs-review'} SessionTodoMarker
 */

/**
 * Full marker state for a session. `status`/`important` are omitted when unset
 * (NOT `null`); `todos` is always present as an array.
 * @typedef {{ status?: SessionStatusMarker, todos: SessionTodoMarker[], important?: boolean }} SessionMarkers
 */

/**
 * Patch payload. Field semantics:
 * - `undefined`: leave existing value unchanged
 * - `null` (status/important): clear the field
 * - array/value: replace
 * @typedef {{ status?: SessionStatusMarker|null, todos?: SessionTodoMarker[], important?: boolean|null }} SessionMarkersPatch
 */

const STORE_VERSION = 1;

/** Mirrors `MAX_TODO_MARKERS` from sessionMarkers.ts. */
const MAX_TODO_MARKERS = 2;

/** Mirrors `STATUS_MARKER_VALUES` from sessionMarkers.ts. */
const STATUS_MARKER_VALUES = ['draft', 'in-progress', 'done', 'blocked', 'archived'];

/** Mirrors `TODO_MARKER_VALUES` from sessionMarkers.ts. */
const TODO_MARKER_VALUES = ['uncommitted', 'untested', 'needs-review'];

const VALID_STATUS_SET = new Set(STATUS_MARKER_VALUES);
const VALID_TODO_SET = new Set(TODO_MARKER_VALUES);

const DB_FILENAME = 'openchamber-sessions.db';

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS session_markers (
    session_id  TEXT    PRIMARY KEY,
    status      TEXT,
    todos       TEXT    NOT NULL DEFAULT '[]',
    important   INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL
  );
`;

const emptyData = () => ({ version: STORE_VERSION, sessions: {} });

/**
 * Build the canonical {@link SessionMarkers} view for a raw entry.
 * Ensures `todos` is always an array and only exposes `status`/`important`
 * when they hold valid set values. Unset fields are omitted (NOT `null`).
 *
 * @param {object|undefined} entry
 * @returns {SessionMarkers}
 */
const normalizeEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return { todos: [] };
  const result = { todos: Array.isArray(entry.todos) ? entry.todos.slice() : [] };
  if (entry.status && VALID_STATUS_SET.has(entry.status)) {
    result.status = entry.status;
  }
  if (entry.important === true) {
    result.important = true;
  }
  return result;
};

/**
 * Normalize a raw row loaded from disk into the canonical {@link SessionMarkers}
 * shape. Mirrors the JSON version's load-time sanitization (dedupe + cap todos,
 * drop invalid status, coerce important to boolean).
 *
 * @param {{ status?: string|null, todos?: string|null, important?: number|null }} row
 * @returns {SessionMarkers}
 */
const normalizeRow = (row) => {
  const normalized = { todos: [] };

  let rawTodos = [];
  if (typeof row.todos === 'string' && row.todos.length > 0) {
    try {
      const parsed = JSON.parse(row.todos);
      if (Array.isArray(parsed)) rawTodos = parsed;
    } catch {
      // ignore malformed JSON — fall through with empty todos
    }
  }
  if (rawTodos.length > 0) {
    const seen = new Set();
    for (const value of rawTodos) {
      if (VALID_TODO_SET.has(value) && !seen.has(value)) {
        seen.add(value);
        normalized.todos.push(value);
      }
    }
    if (normalized.todos.length > MAX_TODO_MARKERS) {
      normalized.todos.length = MAX_TODO_MARKERS;
    }
  }

  if (row.status && VALID_STATUS_SET.has(row.status)) {
    normalized.status = row.status;
  }
  if (row.important === 1 || row.important === true) {
    normalized.important = true;
  }
  return normalized;
};

/**
 * Error thrown when a patch fails validation. Routes map this to HTTP 400.
 */
export class SessionMarkersValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionMarkersValidationError';
  }
}

/**
 * Error thrown when a validated marker change cannot be persisted.
 */
export class SessionMarkersPersistenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionMarkersPersistenceError';
  }
}

/**
 * Validate a patch in place. Throws {@link SessionMarkersValidationError} on
 * any invalid field.
 *
 * @param {unknown} patch
 * @returns {asserts patch is SessionMarkersPatch}
 */
const validatePatch = (patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SessionMarkersValidationError('Patch must be an object');
  }

  if ('status' in patch && patch.status !== undefined && patch.status !== null) {
    if (!VALID_STATUS_SET.has(patch.status)) {
      throw new SessionMarkersValidationError(
        `Invalid status value: ${String(patch.status)}`,
      );
    }
  }

  if ('todos' in patch && patch.todos !== undefined) {
    if (!Array.isArray(patch.todos)) {
      throw new SessionMarkersValidationError('todos must be an array');
    }
    if (patch.todos.length > MAX_TODO_MARKERS) {
      throw new SessionMarkersValidationError(
        `todos exceeds MAX_TODO_MARKERS (${MAX_TODO_MARKERS})`,
      );
    }
    for (const value of patch.todos) {
      if (!VALID_TODO_SET.has(value)) {
        throw new SessionMarkersValidationError(`Invalid todo value: ${String(value)}`);
      }
    }
  }

  if (
    'important' in patch &&
    patch.important !== undefined &&
    patch.important !== null &&
    typeof patch.important !== 'boolean'
  ) {
    throw new SessionMarkersValidationError('important must be a boolean or null');
  }
};

/**
 * Load the SQLite driver, preferring `better-sqlite3` and falling back to
 * `bun:sqlite`. Both expose a compatible sync API for the operations this
 * store uses. Pattern cloned from `interrupted-runs.js`.
 *
 * @returns {{ new (path: string, options?: object): import('better-sqlite3').Database }}
 * @throws {Error} if neither driver is available
 */
const loadDatabaseConstructor = () => {
  if (typeof Bun !== 'undefined') {
    const bunSqlite = require('bun:sqlite');
    if (typeof bunSqlite?.Database === 'function') return bunSqlite.Database;
  }

  let betterSqliteError = null;

  try {
    const BetterSqlite = require('better-sqlite3');
    if (typeof BetterSqlite === 'function') return BetterSqlite;
    if (BetterSqlite && typeof BetterSqlite.Database === 'function') {
      return BetterSqlite.Database;
    }
  } catch (error) {
    betterSqliteError = error;
  }

  const message = betterSqliteError instanceof Error ? betterSqliteError.message : String(betterSqliteError);
  throw new Error(`SQLite runtime unavailable for session markers store: ${message || 'no driver loaded'}`);
};

/**
 * Create a session-markers store.
 *
 * @param {{ fs: object, path: object, dataDir: string, onChange?: (payload: { sessionId: string, markers: SessionMarkers|null }) => void }} opts
 * @returns {{
 *   load: () => void,
 *   applyPatch: (sessionId: string, patch: SessionMarkersPatch) => SessionMarkers,
 *   clear: (sessionId: string) => boolean,
 *   getMarkers: (sessionId: string) => SessionMarkers | null,
 *   getSnapshot: () => { version: number, sessions: Record<string, SessionMarkers> },
 *   flush: () => void,
 *   dispose: () => void,
 * }}
 */
export const createSessionMarkersStore = ({ fs, path, dataDir, onChange }) => {
  const dbPath = path.join(dataDir, DB_FILENAME);
  let data = emptyData();
  /** @type {import('better-sqlite3').Database|null} */
  let db = null;
  /** @type {import('better-sqlite3').Statement|null} */
  let selectAllStmt = null;
  /** @type {import('better-sqlite3').Statement|null} */
  let upsertStmt = null;
  /** @type {import('better-sqlite3').Statement|null} */
  let deleteStmt = null;

  /**
   * Open the DB handle (idempotent — returns the existing handle on repeat
   * calls). Ensures the parent directory exists, runs the schema migration,
   * sets WAL mode, and prepares all statements once for reuse.
   */
  const ensureDb = () => {
    if (db) return db;
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch {
      // directory may already exist or be a parent — ignore
    }
    const DatabaseConstructor = loadDatabaseConstructor();
    const handle = new DatabaseConstructor(dbPath, { create: true });
    try {
      handle.pragma('journal_mode = WAL');
    } catch {
      // some bundled drivers (bun:sqlite) may not expose pragma the same way;
      // WAL is best-effort, not a hard requirement.
    }
    handle.exec(SCHEMA_SQL);
    selectAllStmt = handle.prepare(
      'SELECT session_id AS sessionId, status, todos, important FROM session_markers',
    );
    upsertStmt = handle.prepare(
      `INSERT INTO session_markers (session_id, status, todos, important, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id) DO UPDATE SET
         status     = excluded.status,
         todos      = excluded.todos,
         important  = excluded.important,
         updated_at = excluded.updated_at`,
    );
    deleteStmt = handle.prepare('DELETE FROM session_markers WHERE session_id = ?');
    db = handle;
    return handle;
  };

  /**
   * Persist a single session's markers via the prepared UPSERT statement.
   * Returns true on success, false on error (matching the JSON version's
   * swallow-and-report-success-so-caller-can-gate-broadcast pattern).
   *
   * @param {string} sessionId
   * @param {SessionMarkers} markers
   * @returns {boolean}
   */
  const writeRow = (sessionId, markers) => {
    try {
      ensureDb();
      const status = markers.status && VALID_STATUS_SET.has(markers.status) ? markers.status : null;
      const todosJson = JSON.stringify(Array.isArray(markers.todos) ? markers.todos : []);
      const important = markers.important === true ? 1 : 0;
      const updatedAt = Date.now();
      upsertStmt.run(sessionId, status, todosJson, important, updatedAt);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Delete a single session row. Returns true on success (or row already
   * absent), false on DB error.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  const deleteRow = (sessionId) => {
    try {
      ensureDb();
      deleteStmt.run(sessionId);
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Load persisted state from the SQLite DB. Missing file, schema errors,
   * and row parse failures collapse to an empty default — same tolerance as
   * the JSON version. The in-memory map is rebuilt from the rows so subsequent
   * reads stay sync and don't hit disk.
   */
  const load = () => {
    try {
      ensureDb();
      const rows = selectAllStmt.all();
      const sessions = {};
      for (const row of rows) {
        if (!row || typeof row.sessionId !== 'string') continue;
        sessions[row.sessionId] = normalizeRow(row);
      }
      data = { version: STORE_VERSION, sessions };
    } catch {
      data = emptyData();
    }
  };

  const getMarkers = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return null;
    const entry = data.sessions[sessionId];
    if (!entry) return { todos: [] };
    return normalizeEntry(entry);
  };

  const getSnapshot = () => {
    const sessions = {};
    for (const [id, entry] of Object.entries(data.sessions)) {
      sessions[id] = normalizeEntry(entry);
    }
    return { version: STORE_VERSION, sessions };
  };

  /**
   * Fire the change callback. Invoked AFTER a successful write so clients are
   * never notified about state that failed to persist.
   *
   * @param {string} sessionId
   * @param {SessionMarkers|null} markers — `null` signals a full clear.
   */
  const emitChange = (sessionId, markers) => {
    if (typeof onChange !== 'function') return;
    onChange({ sessionId, markers });
  };

  /**
   * Validate and apply a patch to a session, then persist + broadcast.
   *
   * Patch semantics:
   * - `status`: undefined → leave; null → clear; valid string → set
   * - `todos`: undefined → leave; array → REPLACE (deduped, validated)
   * - `important`: undefined → leave; null/false → clear; true → set
   *
   * Persistence uses an atomic UPSERT. If the write fails, the in-memory view
   * is left unchanged and callers get a deterministic persistence error.
   *
   * @param {string} sessionId
   * @param {SessionMarkersPatch} patch
   * @returns {SessionMarkers} the full markers after the patch
   * @throws {SessionMarkersValidationError} on invalid input
   */
  const applyPatch = (sessionId, patch) => {
    if (!sessionId || typeof sessionId !== 'string') return { todos: [] };
    validatePatch(patch);

    const existing = data.sessions[sessionId] || { todos: [] };
    const next = { todos: Array.isArray(existing.todos) ? existing.todos.slice() : [] };
    if (existing.status && VALID_STATUS_SET.has(existing.status)) next.status = existing.status;
    if (existing.important === true) next.important = true;

    if ('status' in patch) {
      if (patch.status === undefined) {
        // leave unchanged
      } else if (patch.status === null) {
        delete next.status;
      } else {
        next.status = patch.status;
      }
    }

    if ('todos' in patch && patch.todos !== undefined) {
      const seen = new Set();
      const deduped = [];
      for (const value of patch.todos) {
        if (VALID_TODO_SET.has(value) && !seen.has(value)) {
          seen.add(value);
          deduped.push(value);
        }
      }
      next.todos = deduped;
    }

    if ('important' in patch) {
      if (patch.important === undefined) {
        // leave unchanged
      } else if (patch.important === null || patch.important === false) {
        delete next.important;
      } else {
        next.important = true;
      }
    }

    const view = normalizeEntry(next);
    if (!writeRow(sessionId, view)) {
      throw new SessionMarkersPersistenceError('Failed to persist session markers');
    }
    data.sessions[sessionId] = view;
    emitChange(sessionId, view);
    return view;
  };

  /**
   * Remove all markers for a session. Broadcasts `null` on success (including
   * the idempotent case where no entry existed).
   *
   * @param {string} sessionId
   * @returns {boolean} true if the clear succeeded
   */
  const clear = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') return false;
    const hadEntry = sessionId in data.sessions;
    if (hadEntry) {
      if (!deleteRow(sessionId)) {
        throw new SessionMarkersPersistenceError('Failed to clear session markers');
      }
      delete data.sessions[sessionId];
    }
    emitChange(sessionId, null);
    return true;
  };

  /**
   * No-op for the SQLite backend — writes are already synchronous. Kept for
   * interface compatibility with callers that flush on shutdown.
   */
  const flush = () => {};

  /**
   * Close the DB handle. Safe to call multiple times; subsequent calls are
   * no-ops. After dispose, the store should not be reused — re-construct it
   * via {@link createSessionMarkersStore} instead.
   */
  const dispose = () => {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore close errors on teardown
      }
      db = null;
      selectAllStmt = null;
      upsertStmt = null;
      deleteStmt = null;
    }
  };

  return {
    load,
    applyPatch,
    clear,
    getMarkers,
    getSnapshot,
    flush,
    dispose,
  };
};
