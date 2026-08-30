import { create } from 'zustand';

import {
  deleteAgentMemory,
  fetchAgentMemory,
  updateAgentMemory,
  type AgentMemoryEntry,
  type AgentMemoryScope,
  type AgentMemoryType,
} from '@/lib/agentMemoryApi';
import { resolveProjectContextId, type ProjectRef } from '@/lib/projectContextApi';

export interface AgentMemoryStoreEntry {
  available: boolean | null;
  global: AgentMemoryEntry[];
  project: AgentMemoryEntry[];
  globalFailed: boolean;
  projectFailed: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
}

export const EMPTY_AGENT_MEMORY_STORE_ENTRY: AgentMemoryStoreEntry = {
  available: null,
  global: [],
  project: [],
  globalFailed: false,
  projectFailed: false,
  loaded: false,
  loading: false,
  error: null,
};

interface AgentMemoryStore {
  entries: Record<string, AgentMemoryStoreEntry>;
  load: (project: ProjectRef, options?: { force?: boolean }) => Promise<void>;
  update: (
    project: ProjectRef,
    scope: AgentMemoryScope,
    memoryId: string,
    patch: { title?: string; body?: string; type?: AgentMemoryType },
  ) => Promise<boolean>;
  remove: (project: ProjectRef, scope: AgentMemoryScope, memoryId: string) => Promise<boolean>;
}

const errorMessage = (error: unknown, fallback: string): string => (
  error instanceof Error && error.message ? error.message : fallback
);

export const useAgentMemoryStore = create<AgentMemoryStore>((set, get) => {
  const patch = (key: string, value: Partial<AgentMemoryStoreEntry>) => {
    set((state) => ({
      entries: {
        ...state.entries,
        [key]: { ...(state.entries[key] ?? EMPTY_AGENT_MEMORY_STORE_ENTRY), ...value },
      },
    }));
  };

  return {
    entries: {},

    load: async (project, options = {}) => {
      const key = resolveProjectContextId(project);
      if (!key) return;
      const current = get().entries[key] ?? EMPTY_AGENT_MEMORY_STORE_ENTRY;
      if (current.loading || (current.loaded && !options.force)) return;
      patch(key, { loading: true, error: null });
      try {
        const result = await fetchAgentMemory(project);
        if (!result.enabled) {
          patch(key, {
            available: false,
            global: [],
            project: [],
            globalFailed: false,
            projectFailed: false,
            loaded: true,
            loading: false,
            error: null,
          });
          return;
        }
        patch(key, {
          available: true,
          global: result.global,
          project: result.project,
          globalFailed: result.globalFailed,
          projectFailed: result.projectFailed,
          loaded: true,
          loading: false,
          error: null,
        });
      } catch (error) {
        patch(key, { loading: false, error: errorMessage(error, 'Failed to load agent memory') });
      }
    },

    update: async (project, scope, memoryId, value) => {
      const key = resolveProjectContextId(project);
      if (!key) return false;
      patch(key, { error: null });
      try {
        const result = await updateAgentMemory(project, scope, memoryId, value);
        patch(key, { [scope]: result.entries, loaded: true, available: true });
        return true;
      } catch (error) {
        patch(key, { error: errorMessage(error, 'Failed to update agent memory') });
        return false;
      }
    },

    remove: async (project, scope, memoryId) => {
      const key = resolveProjectContextId(project);
      if (!key) return false;
      patch(key, { error: null });
      try {
        const entries = await deleteAgentMemory(project, scope, memoryId);
        patch(key, { [scope]: entries, loaded: true, available: true });
        return true;
      } catch (error) {
        patch(key, { error: errorMessage(error, 'Failed to delete agent memory') });
        return false;
      }
    },
  };
});
