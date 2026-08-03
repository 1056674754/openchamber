import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';
import { readLastActiveSession } from '@/sync/last-session-cache';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { normalizePath } from '@/lib/pathNormalization';
import type { ProjectEntry } from '@/lib/api/types';

/**
 * Sentinal serverId used by UI hooks when a session's owning server cannot be
 * established. Distinct from DEFAULT_SERVER_ID so consumers that branch on
 * `!== DEFAULT_SERVER_ID` do not silently treat an unresolved remote session
 * as local. Consumers must render loading/error until real authority arrives.
 */
export const UNRESOLVED_SERVER_ID = '';

/** Authoritative ownership of a session. `null` fields mean "not yet resolved".
 *  Never falls back to the default/local server: a session-scoped query must
 *  fail closed when ownership is unknown rather than degrade to local state. */
export type SessionAuthority = {
  readonly serverId: string | null;
  readonly directory: string | null;
};

type SessionDirectoryGetter = (sessionId: string) => string | null;
type SessionProjectGetter = (sessionId: string) => ProjectEntry | null;

let sessionDirectoryGetter: SessionDirectoryGetter | null = null;
let sessionProjectGetter: SessionProjectGetter | null = null;

/** Injected by session-ui-store (which depends on session-routing, which
 *  depends on this module). Injection avoids a module-level import cycle:
 *  this module must stay dependency-free of session-ui-store. */
export function setSessionDirectoryGetter(getter: SessionDirectoryGetter): void {
  sessionDirectoryGetter = getter;
}

/** Injected by useSessionProjectStore. Injected (not imported) because that
 *  store transitively pulls in opencodeClient → session-routing, which depends
 *  on this module — a module-level import would form a cycle. */
export function setSessionProjectGetter(getter: SessionProjectGetter): void {
  sessionProjectGetter = getter;
}

/** Raised when a session-scoped operation needs a server but the session has no
 *  authoritative binding. Callers should recover authority from the session→
 *  project binding or persisted restore data and index it before retrying. */
export class UnresolvedSessionServerError extends Error {
  constructor(sessionId: string) {
    super(
      `Session ${sessionId} has no authoritative server binding; refusing to fall back to the default/local server`,
    );
    this.name = 'UnresolvedSessionServerError';
  }
}

/**
 * Central authority resolver for a session.
 *
 * Resolution order (strongest first):
 *  1. runtime serverRegistry session→server index (authoritative)
 *  2. persisted session→project binding (project.serverId / project.path)
 *  3. persisted last-active-session cache (directory only, serverId only when
 *     it agrees with an existing resolution)
 *  4. session UI store directory (derived, directory only)
 *
 * Returns null fields for anything unresolved. NEVER returns DEFAULT_SERVER_ID
 * as a substitute: a remote session must not degrade into the local server.
 */
export function resolveSessionAuthority(sessionId: string | null | undefined): SessionAuthority {
  if (!sessionId) {
    return { serverId: null, directory: null };
  }

  // Tier 1: authoritative runtime index.
  let serverId = serverRegistry.getServerForSession(sessionId) ?? null;

  // Tier 2: persisted session→project binding.
  const boundProject = sessionProjectGetter?.(sessionId) ?? null;
  if (!serverId && boundProject) {
    serverId = boundProject.serverId ?? DEFAULT_SERVER_ID;
  }

  // Tier 3: persisted last-active-session (only when consistent).
  const persisted = readLastActiveSession(getRuntimeKey());
  if (persisted?.sessionId === sessionId && (!serverId || persisted.serverId === serverId)) {
    if (!serverId) {
      serverId = persisted.serverId;
    }
  }

  const directory =
    normalizePath(sessionDirectoryGetter?.(sessionId) ?? null)
    ?? (persisted?.sessionId === sessionId ? normalizePath(persisted.directory) : null)
    ?? normalizePath(boundProject?.path ?? null)
    ?? null;

  return { serverId, directory };
}

/** Resolve authority or fail closed. Use for imperative session-scoped
 *  operations (sdk/client/store selection) where a wrong-server fallback is
 *  worse than an explicit error. */
export function requireSessionAuthority(sessionId: string): SessionAuthority {
  const authority = resolveSessionAuthority(sessionId);
  if (!authority.serverId) {
    throw new UnresolvedSessionServerError(sessionId);
  }
  return authority;
}
