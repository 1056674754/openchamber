import { create } from 'zustand';

export type ToolPermissionValue = 'ask' | 'allow' | 'deny';

export interface ToolRule {
  rule: ToolPermissionValue;
}

export interface PermissionsState {
  global: Record<string, ToolPermissionValue>;
  agents: Record<string, Record<string, ToolPermissionValue>>;
  loading: boolean;
  saving: boolean;
  error: string | null;

  loadPermissions: () => Promise<void>;
  setToolPermission: (toolName: string, rule: ToolPermissionValue, agentName?: string) => Promise<void>;
  setBulkPermissions: (global: Record<string, ToolPermissionValue>, agents: Record<string, Record<string, ToolPermissionValue>>) => Promise<void>;
  clearError: () => void;
}

function parseServerPermission(permission: unknown): Record<string, ToolPermissionValue> {
  if (!permission || typeof permission !== 'object' || Array.isArray(permission)) return {};
  const result: Record<string, ToolPermissionValue> = {};
  for (const [key, value] of Object.entries(permission as Record<string, unknown>)) {
    if (value === 'ask' || value === 'allow' || value === 'deny') {
      result[key] = value as ToolPermissionValue;
    }
  }
  return result;
}

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  global: {},
  agents: {},
  loading: false,
  saving: false,
  error: null,

  loadPermissions: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const resp = await fetch('/api/config/permissions');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const global = parseServerPermission(data.global);
      const agents: Record<string, Record<string, ToolPermissionValue>> = {};
      if (data.agents && typeof data.agents === 'object') {
        for (const [agentName, perms] of Object.entries(data.agents)) {
          agents[agentName] = parseServerPermission(perms);
        }
      }
      set({ global, agents, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load permissions' });
    }
  },

  setToolPermission: async (toolName, rule, agentName) => {
    set({ saving: true, error: null });
    try {
      const body: Record<string, unknown> = { rule, scope: 'user' };
      if (agentName) body.agentName = agentName;
      const resp = await fetch(`/api/config/permissions/${toolName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const current = get();
      if (agentName) {
        const agentPerms = { ...(current.agents[agentName] ?? {}) };
        agentPerms[toolName] = rule;
        set({ agents: { ...current.agents, [agentName]: agentPerms }, saving: false });
      } else {
        set({ global: { ...current.global, [toolName]: rule }, saving: false });
      }
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to update permission' });
    }
  },

  setBulkPermissions: async (global, agents) => {
    set({ saving: true, error: null });
    try {
      const resp = await fetch('/api/config/permissions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ global, agents, scope: 'user' }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      set({ global, agents, saving: false });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to save permissions' });
    }
  },

  clearError: () => set({ error: null }),
}));
