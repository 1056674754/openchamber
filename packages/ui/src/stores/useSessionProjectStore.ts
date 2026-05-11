import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { getSafeStorage } from './utils/safeStorage';

const STORAGE_KEY = 'oc.sessions.projectBindings';

const safeStorage = getSafeStorage();

const readPersistedBindings = (): Map<string, string> => {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Map();
    }
    const map = new Map<string, string>();
    for (const [sessionId, projectId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof sessionId === 'string' && typeof projectId === 'string' && sessionId && projectId) {
        map.set(sessionId, projectId);
      }
    }
    return map;
  } catch {
    return new Map();
  }
};

const persistBindings = (bindings: Map<string, string>): void => {
  try {
    if (bindings.size === 0) {
      safeStorage.removeItem(STORAGE_KEY);
      return;
    }
    const serialized: Record<string, string> = {};
    bindings.forEach((projectId, sessionId) => {
      serialized[sessionId] = projectId;
    });
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // ignored
  }
};

interface SessionProjectStore {
  bindings: Map<string, string>;

  /**
   * Authoritative session→project assignment. Writes are persisted to
   * localStorage so the binding survives reload. Use `bindMany` when
   * hydrating from a path-prefix sweep to avoid N localStorage writes.
   */
  bind: (sessionId: string, projectId: string) => void;
  bindMany: (entries: Iterable<readonly [sessionId: string, projectId: string]>) => void;
  unbind: (sessionId: string) => void;
  unbindMany: (sessionIds: Iterable<string>) => void;

  /**
   * Cascade cleanup when a project is removed. All sessions bound to the
   * removed project become unbound and will fall back to path-prefix
   * resolution on next ownership query (which typically returns null,
   * making them invisible until re-bound).
   */
  clearForProject: (projectId: string) => void;

  getProject: (sessionId: string) => string | null;
}

export const useSessionProjectStore = create<SessionProjectStore>()(
  devtools((set, get) => ({
    bindings: readPersistedBindings(),

    bind: (sessionId, projectId) => {
      if (!sessionId || !projectId) return;
      const current = get().bindings;
      if (current.get(sessionId) === projectId) return;
      const next = new Map(current);
      next.set(sessionId, projectId);
      set({ bindings: next });
      persistBindings(next);
    },

    bindMany: (entries) => {
      const current = get().bindings;
      let changed = false;
      const next = new Map(current);
      for (const [sessionId, projectId] of entries) {
        if (!sessionId || !projectId) continue;
        if (next.get(sessionId) === projectId) continue;
        next.set(sessionId, projectId);
        changed = true;
      }
      if (!changed) return;
      set({ bindings: next });
      persistBindings(next);
    },

    unbind: (sessionId) => {
      const current = get().bindings;
      if (!current.has(sessionId)) return;
      const next = new Map(current);
      next.delete(sessionId);
      set({ bindings: next });
      persistBindings(next);
    },

    unbindMany: (sessionIds) => {
      const current = get().bindings;
      let changed = false;
      const next = new Map(current);
      for (const id of sessionIds) {
        if (next.delete(id)) changed = true;
      }
      if (!changed) return;
      set({ bindings: next });
      persistBindings(next);
    },

    clearForProject: (projectId) => {
      const current = get().bindings;
      let changed = false;
      const next = new Map(current);
      for (const [sessionId, boundProjectId] of current) {
        if (boundProjectId === projectId) {
          next.delete(sessionId);
          changed = true;
        }
      }
      if (!changed) return;
      set({ bindings: next });
      persistBindings(next);
    },

    getProject: (sessionId) => get().bindings.get(sessionId) ?? null,
  }), { name: 'session-project-store' })
);
