import { create } from 'zustand';

export interface ConfigDiffEntry {
  key: string;
  source: string;
  target: string;
  selected: boolean;
}

interface ConfigSyncState {
  differences: ConfigDiffEntry[];
  loading: boolean;
  pushing: boolean;
  pulling: boolean;
  error: string | null;

  loadDiff: (sourceInstance: string, targetInstance: string) => Promise<void>;
  toggleSelect: (index: number) => void;
  selectAll: () => void;
  pushSelected: () => Promise<boolean>;
  pushAll: () => Promise<boolean>;
  pullFromRemote: () => Promise<boolean>;
  clearError: () => void;
}

export const useConfigSyncStore = create<ConfigSyncState>((set, get) => ({
  differences: [],
  loading: false,
  pushing: false,
  pulling: false,
  error: null,

  loadDiff: async () => {
    set({ loading: true, error: null });
    try {
      const resp = await fetch('/api/config/full');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const merged = data.merged ?? {};
      const samples: ConfigDiffEntry[] = [];

      const walk = (obj: Record<string, unknown>, prefix: string) => {
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            walk(value as Record<string, unknown>, fullKey);
          } else {
            const strVal = typeof value === 'string' ? value : JSON.stringify(value);
            samples.push({
              key: fullKey,
              source: strVal,
              target: '(not synced)',
              selected: true,
            });
          }
        }
      };

      walk(merged, '');
      set({ differences: samples, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to load diff' });
    }
  },

  toggleSelect: (index) => {
    set((state) => {
      const next = [...state.differences];
      next[index] = { ...next[index], selected: !next[index].selected };
      return { differences: next };
    });
  },

  selectAll: () => {
    set((state) => ({
      differences: state.differences.map((d) => ({ ...d, selected: true })),
    }));
  },

  pushSelected: async () => {
    set({ pushing: true, error: null });
    try {
      const selected = get().differences.filter((d) => d.selected);
      await fetch('/api/config/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: selected }),
      });
      set({ pushing: false });
      return true;
    } catch (err) {
      set({ pushing: false, error: err instanceof Error ? err.message : 'Push failed' });
      return false;
    }
  },

  pushAll: async () => {
    set((state) => ({
      differences: state.differences.map((d) => ({ ...d, selected: true })),
    }));
    return get().pushSelected();
  },

  pullFromRemote: async () => {
    set({ pulling: true, error: null });
    try {
      await fetch('/api/config/sync/pull', { method: 'POST' });
      set({ pulling: false });
      return true;
    } catch (err) {
      set({ pulling: false, error: err instanceof Error ? err.message : 'Pull failed' });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
