import { z } from "zod"
import type { Session } from "@opencode-ai/sdk/v2/client"

/**
 * How a session answers tool permissions. The server owns the policy
 * (`packages/web/server/lib/permission-auto-accept`):
 *
 * - `ask`: every request waits for the user.
 * - `safety`: accepted unless the safety net (Jev) says the user should decide.
 * - `auto`: every request is accepted.
 *
 * Upstream: segb 1bc709ed0.
 */
export const permissionModeSchema = z.enum(["ask", "safety", "auto"])

export type PermissionMode = z.infer<typeof permissionModeSchema>

export type PermissionModeMap = Record<string, PermissionMode>

/**
 * The mode the user sees. Without a classification provider there is no safety
 * net, and a `safety` session waits for the user exactly as an `ask` one does.
 */
export const displayedPermissionMode = (mode: PermissionMode, safetyAvailable: boolean): PermissionMode =>
  mode === "safety" && !safetyAvailable ? "ask" : mode

/** The composer button's cycle: ask → safety → auto → ask, skipping safety while it is unavailable. */
export const nextPermissionMode = (mode: PermissionMode, safetyAvailable: boolean): PermissionMode => {
  const shown = displayedPermissionMode(mode, safetyAvailable)
  if (shown === "ask") return safetyAvailable ? "safety" : "auto"
  if (shown === "safety") return "auto"
  return "ask"
}

export type PermissionPolicySnapshot = {
  modes: PermissionModeMap
}

/**
 * A policy as the server or VS Code's bridge sends it, over HTTP or as a
 * broadcast. `modes` is the policy; servers from before the modes and VS Code
 * send only `sessions` as on/off, where on means `auto`.
 */
export const permissionPolicyWireSchema = z.object({
  sessions: z.record(z.string().min(1), z.boolean()).optional(),
  modes: z.record(z.string().min(1), permissionModeSchema).optional(),
  revision: z.number().int().nonnegative().optional(),
})

export type PermissionPolicyWire = z.infer<typeof permissionPolicyWireSchema>

export const policySnapshotFromWire = (wire: PermissionPolicyWire): PermissionPolicySnapshot => ({
  modes: wire.modes ?? Object.fromEntries(
    Object.entries(wire.sessions ?? {}).map(([sessionId, enabled]) => [sessionId, enabled ? "auto" : "ask"] as const),
  ),
})

const buildSessionMap = (sessions: Session[]): Map<string, Session> => {
  const map = new Map<string, Session>();
  for (const session of sessions) {
    map.set(session.id, session);
  }
  return map;
};

const resolveLineage = (sessionID: string, sessions: Session[]): string[] => {
  const map = buildSessionMap(sessions);
  const result: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = sessionID;

  while (current && !seen.has(current)) {
    seen.add(current);
    result.push(current);
    current = map.get(current)?.parentID;
  }

  return result;
};

/** The nearest explicit mode up the session's lineage, `ask` when there is none. */
export const resolvePermissionMode = (input: {
  modes: PermissionModeMap;
  sessions: Session[];
  sessionID: string;
}): PermissionMode => {
  const { modes, sessions, sessionID } = input;
  if (Object.keys(modes).length === 0) {
    return "ask";
  }

  for (const id of resolveLineage(sessionID, sessions)) {
    const mode = modes[id];
    if (mode) {
      return mode;
    }
  }

  return "ask";
};

/** What clients that only know on/off see: anything but `ask` answers requests by itself. */
export const isAutoAnsweringMode = (mode: PermissionMode): boolean => mode === "safety" || mode === "auto"
