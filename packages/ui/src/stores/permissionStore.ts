import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { Session } from "@opencode-ai/sdk/v2/client";
import {
    isAutoAnsweringMode,
    permissionPolicyWireSchema,
    policySnapshotFromWire,
    resolvePermissionMode,
    type PermissionMode,
    type PermissionModeMap,
} from "./utils/permissionAutoAccept";
import { createDeferredSafeJSONStorage } from "./utils/safeStorage";
import { getAllSyncSessions, getSyncChildStores } from "@/sync/sync-refs";
import { opencodeClient } from "@/lib/opencode/client";
import { respondToPermission } from "@/sync/session-actions";
import { useSessionUIStore } from "@/sync/session-ui-store";

interface PermissionState {
    // The policy itself. Persisted v3; a pre-modes v1/v2 boolean map migrates
    // on rehydration (true → auto, false → ask).
    modes: PermissionModeMap;
}

interface PermissionActions {
    applySnapshot: (snapshot: { sessions?: Readonly<Record<string, unknown>>; modes?: Readonly<Record<string, unknown>> }) => void;
    /** Legacy on/off view for surfaces that predate the modes (VS Code notifications, scheduled tasks). */
    isSessionAutoAccepting: (sessionId: string) => boolean;
    getSessionMode: (sessionId: string) => PermissionMode;
    setSessionMode: (sessionId: string, mode: PermissionMode) => Promise<void>;
}

type PermissionStore = PermissionState & PermissionActions;

const coerceSessionMode = (value: unknown): PermissionMode | null => {
    if (value === "ask" || value === "safety" || value === "auto") {
        return value;
    }
    // Pre-modes boolean entries from a v1/v2 local policy.
    if (value === true) return "auto";
    if (value === false) return "ask";
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true") return "auto";
        if (normalized === "false") return "ask";
    }
    return null;
};

const isLegacyDirectoryAutoAcceptKey = (key: string): boolean => key.endsWith("/*");

const extractSessionIdFromLegacyKey = (key: string): string | null => {
    const trimmed = key.trim();
    if (!trimmed) {
        return null;
    }
    const lastSlash = trimmed.lastIndexOf("/");
    if (lastSlash === -1 || lastSlash === trimmed.length - 1) {
        return trimmed;
    }
    return trimmed.slice(lastSlash + 1);
};

const resolveSessionScope = (sessionID: string, sessions: Session[]): Set<string> => {
    const map = new Map<string, Session>();
    const children = new Map<string, string[]>();
    for (const session of sessions) {
        map.set(session.id, session);
        if (session.parentID) {
            const list = children.get(session.parentID);
            if (list) {
                list.push(session.id);
            } else {
                children.set(session.parentID, [session.id]);
            }
        }
    }

    if (!map.has(sessionID)) {
        return new Set([sessionID]);
    }

    const result = new Set<string>();
    const seen = new Set<string>();
    const queue = [sessionID];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || seen.has(current)) {
            continue;
        }
        seen.add(current);
        result.add(current);
        const nextChildren = children.get(current);
        if (!nextChildren || nextChildren.length === 0) {
            continue;
        }
        for (const child of nextChildren) {
            if (!seen.has(child)) {
                queue.push(child);
            }
        }
    }

    return result;
};

const normalizeDirectoryCandidate = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const collectPendingFromSyncStores = (): Array<{ id: string; sessionID: string }> => {
    try {
        const stores = getSyncChildStores();
        const pending: Array<{ id: string; sessionID: string }> = [];
        for (const store of stores.children.values()) {
            const permissionMap = store.getState().permission ?? {};
            for (const [sessionId, entries] of Object.entries(permissionMap)) {
                for (const permission of entries ?? []) {
                    if (!permission?.id) continue;
                    pending.push({ id: permission.id, sessionID: permission.sessionID || sessionId });
                }
            }
        }
        return pending;
    } catch {
        return [];
    }
};

const sessionBelongsToScope = async (
    sessionID: string,
    rootSessionID: string,
    knownSessions: Session[],
    directories: string[],
): Promise<boolean> => {
    if (sessionID === rootSessionID) {
        return true;
    }

    const knownById = new Map<string, Session>();
    for (const session of knownSessions) {
        knownById.set(session.id, session);
    }

    const fetchedById = new Map<string, Session>();
    const fetchSession = async (id: string): Promise<Session | null> => {
        const known = knownById.get(id) ?? fetchedById.get(id);
        if (known) return known;

        for (const directory of directories) {
            try {
                const result = await opencodeClient.getScopedSdkClient(directory).session.get({
                    sessionID: id,
                    directory,
                });
                if (result.data) {
                    fetchedById.set(id, result.data);
                    return result.data;
                }
            } catch {
                // Try the next known project directory.
            }
        }

        try {
            const result = await opencodeClient.getSdkClient().session.get({ sessionID: id });
            if (result.data) {
                fetchedById.set(id, result.data);
                return result.data;
            }
        } catch {
            // Missing session metadata means we cannot safely inherit the parent setting.
        }

        return null;
    };

    const seen = new Set<string>();
    let current: string | undefined = sessionID;
    while (current && !seen.has(current)) {
        if (current === rootSessionID) {
            return true;
        }
        seen.add(current);
        const session = await fetchSession(current);
        current = session?.parentID ?? undefined;
    }

    return false;
};

const readStoredModes = (value: unknown): PermissionModeMap => {
    const parsed = permissionPolicyWireSchema.safeParse(value);
    if (!parsed.success) {
        return {};
    }
    return policySnapshotFromWire(parsed.data).modes;
};

const getStorage = () => createDeferredSafeJSONStorage();

export const usePermissionStore = create<PermissionStore>()(
    devtools(
        persist(
            (set, get) => ({
                modes: {},

                applySnapshot: (snapshot) => {
                    const modes = readStoredModes(snapshot);

                    set((state) => {
                        const currentEntries = Object.entries(state.modes);
                        const nextEntries = Object.entries(modes);
                        const unchanged = currentEntries.length === nextEntries.length
                            && nextEntries.every(([sessionId, mode]) => state.modes[sessionId] === mode);
                        return unchanged ? state : { modes };
                    });
                },

                isSessionAutoAccepting: (sessionId: string) => {
                    return isAutoAnsweringMode(get().getSessionMode(sessionId));
                },

                getSessionMode: (sessionId: string) => {
                    if (!sessionId) {
                        return "ask";
                    }

                    const sessions = getAllSyncSessions();
                    return resolvePermissionMode({ modes: get().modes, sessions, sessionID: sessionId });
                },

                setSessionMode: async (sessionId: string, mode: PermissionMode) => {
                    if (!sessionId) {
                        return;
                    }

                    const sessions = getAllSyncSessions();

                    set((state) => {
                        const modes = { ...state.modes };
                        modes[sessionId] = mode;
                        return { modes };
                    });

                    const sessionScope = resolveSessionScope(sessionId, sessions);
                    // Only an `auto` session is answered without the user here.
                    // A `safety` session is the server's to answer: its held
                    // requests must reach the user, so they are not mirrored
                    // as suppressed. The server runtime holds the mode itself.
                    const mirroredEnabled = mode === "auto";

                    // Mirror inherited state to the server so it can suppress
                    // permission notifications before the client auto-response
                    // round-trip. Send known descendants too; server-side
                    // ancestry lookup can lag OpenCode session indexing.
                    for (const scopedSessionId of sessionScope) {
                        void fetch('/api/notifications/auto-accept', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionId: scopedSessionId, enabled: mirroredEnabled }),
                        }).catch(() => { /* best-effort */ });
                    }

                    // The mode write itself goes to the policy route: booleans
                    // there are the pre-modes on/off view, so mode-aware
                    // clients send `mode` and keep the on/off view in step.
                    const currentDirectory = normalizeDirectoryCandidate(opencodeClient.getDirectory());
                    void fetch(`/api/permission-auto-accept/sessions/${encodeURIComponent(sessionId)}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode, enabled: mode !== "ask", directory: currentDirectory ?? undefined }),
                    }).catch(() => { /* best-effort; the local policy already applies */ });

                    if (mode !== "auto") {
                        return;
                    }

                    const sessionDirectory = useSessionUIStore.getState().getDirectoryForSession(sessionId);
                    const directories = new Set<string>();
                    if (currentDirectory) {
                        directories.add(currentDirectory);
                    }
                    const mappedSessionDirectory = normalizeDirectoryCandidate(sessionDirectory);
                    if (mappedSessionDirectory) {
                        directories.add(mappedSessionDirectory);
                    }
                    for (const scopedSessionId of sessionScope) {
                        const mapped = normalizeDirectoryCandidate(useSessionUIStore.getState().getDirectoryForSession(scopedSessionId));
                        if (mapped) {
                            directories.add(mapped);
                        }
                    }

                    const directoryList = Array.from(directories);
                    const pendingFromStores = collectPendingFromSyncStores();
                    const pendingFromApi = await opencodeClient
                        .listPendingPermissions({ directories: Array.from(directories) })
                        .catch(() => []);
                    const mergedPending = new Map<string, { id: string; sessionID: string }>();

                    for (const permission of pendingFromStores) {
                        if (sessionScope.has(permission.sessionID)) {
                            mergedPending.set(permission.id, permission);
                            continue;
                        }
                        if (await sessionBelongsToScope(permission.sessionID, sessionId, sessions, directoryList)) {
                            mergedPending.set(permission.id, permission);
                        }
                    }
                    for (const permission of pendingFromApi) {
                        if (!permission?.id || !permission?.sessionID) {
                            continue;
                        }
                        if (!sessionScope.has(permission.sessionID)) {
                            const belongsToScope = await sessionBelongsToScope(permission.sessionID, sessionId, sessions, directoryList);
                            if (!belongsToScope) {
                                continue;
                            }
                        }
                        mergedPending.set(permission.id, { id: permission.id, sessionID: permission.sessionID });
                    }

                    await Promise.all(
                        Array.from(mergedPending.values())
                            .map((permission) => respondToPermission(permission.sessionID, permission.id, "once").catch(() => undefined)),
                    );
                },
            }),
            {
                name: "permission-store",
                version: 3,
                storage: getStorage(),
                partialize: (state) => ({ modes: state.modes }),
                migrate: (persisted) => {
                    const state = persisted && typeof persisted === "object" ? persisted as Record<string, unknown> : {};
                    const modes: PermissionModeMap = {};
                    const source = state.modes && typeof state.modes === "object" && !Array.isArray(state.modes)
                        ? state.modes as Record<string, unknown>
                        : state.autoAccept && typeof state.autoAccept === "object" && !Array.isArray(state.autoAccept)
                            ? state.autoAccept as Record<string, unknown>
                            : {};
                    for (const [rawKey, rawMode] of Object.entries(source)) {
                        if (rawKey.includes("/") || isLegacyDirectoryAutoAcceptKey(rawKey)) {
                            continue;
                        }
                        const mode = coerceSessionMode(rawMode);
                        if (mode) {
                            modes[rawKey] = mode;
                        }
                    }
                    // Directory-scoped keys from a v1 policy collapse onto their
                    // session id when that id has no explicit entry yet.
                    if (state.autoAccept && typeof state.autoAccept === "object" && !Array.isArray(state.autoAccept)) {
                        for (const [rawKey, rawEnabled] of Object.entries(state.autoAccept as Record<string, unknown>)) {
                            if (!rawKey.includes("/")) continue;
                            const sessionId = extractSessionIdFromLegacyKey(rawKey);
                            if (!sessionId || Object.prototype.hasOwnProperty.call(modes, sessionId)) continue;
                            const mode = coerceSessionMode(rawEnabled);
                            if (mode) modes[sessionId] = mode;
                        }
                    }
                    return { modes } as PermissionStore;
                },
                merge: (persistedState, currentState) => {
                    const persisted = persistedState && typeof persistedState === "object"
                        ? persistedState as Partial<PermissionStore>
                        : {};
                    return {
                        ...currentState,
                        ...persisted,
                        modes: persisted.modes && typeof persisted.modes === "object" ? { ...persisted.modes } : {},
                    };
                },
                onRehydrateStorage: () => (state) => {
                    if (!state) return;
                    // Re-broadcast auto-accept state to the server after
                    // rehydration so server-side notification suppression
                    // survives page reloads / server restarts. Only `auto`
                    // sessions are answered without the user (safety held
                    // requests must reach the user).
                    for (const [sid, mode] of Object.entries(state.modes || {})) {
                        if (mode === "auto") {
                            void fetch('/api/notifications/auto-accept', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ sessionId: sid, enabled: true }),
                            }).catch(() => { /* best-effort */ });
                        }
                    }
                },
            }
        ),
        { name: "permission-store" }
    )
);
