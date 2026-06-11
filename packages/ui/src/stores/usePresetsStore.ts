import { create } from 'zustand';

export interface PresetEntry {
  id: string;
  name: string;
  description: string;
  changes: string[];
  config: Record<string, unknown>;
  ohMyOpenAgent?: Record<string, unknown>;
}

const BUILTIN_PRESETS: PresetEntry[] = [
  {
    id: 'basic-dev',
    name: 'Basic Dev',
    description: 'Install oh-my-openagent + 11 agents + 8 skills. Sets Claude Sonnet as default model.',
    changes: ['plugin: +oh-my-openagent', 'model: claude-sonnet-4', 'agents: Sisyphus, Oracle, Librarian, Explore, +7 more'],
    config: {
      plugin: ['oh-my-openagent'],
      model: 'anthropic/claude-sonnet-4-20250514',
      $schema: 'https://opencode.ai/config.json',
    },
    ohMyOpenAgent: {
      team_mode: { enabled: false },
    },
  },
  {
    id: 'full-stack',
    name: 'Full DevOps',
    description: 'Install all tools + Team Mode (5 members) + GitLab integration.',
    changes: ['plugin: +oh-my-openagent, +@gitlab/opencode-gitlab-auth', 'model: claude-sonnet-4', 'team_mode: enabled (5)'],
    config: {
      plugin: ['oh-my-openagent', '@gitlab/opencode-gitlab-auth'],
      model: 'anthropic/claude-sonnet-4-20250514',
      $schema: 'https://opencode.ai/config.json',
    },
    ohMyOpenAgent: {
      team_mode: { enabled: true, max_parallel_members: 5 },
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'OpenCode with no plugins. Useful for remote instances with limited resources.',
    changes: ['model: claude-haiku-3.5', 'compaction.auto: true', 'plugin: []'],
    config: {
      model: 'anthropic/claude-haiku-3-5-20241022',
      compaction: { auto: true, tail_turns: 2 },
      $schema: 'https://opencode.ai/config.json',
    },
  },
];

interface PresetsState {
  presets: PresetEntry[];
  applying: boolean;
  applyingId: string | null;
  previewData: { preset: PresetEntry; scope: string } | null;
  error: string | null;

  loadPresets: () => void;
  previewPreset: (preset: PresetEntry, scope: string) => void;
  applyPreset: () => Promise<boolean>;
  closePreview: () => void;
  saveAsPreset: () => Promise<void>;
}

export const usePresetsStore = create<PresetsState>((set, get) => ({
  presets: BUILTIN_PRESETS,
  applying: false,
  applyingId: null,
  previewData: null,
  error: null,

  loadPresets: () => {
    set({ presets: BUILTIN_PRESETS });
  },

  previewPreset: (preset, scope) => {
    set({ previewData: { preset, scope } });
  },

  applyPreset: async () => {
    const { previewData } = get();
    if (!previewData) return false;

    set({ applying: true, applyingId: previewData.preset.id, error: null });
    try {
      const resp = await fetch('/api/config/section/preset', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: previewData.preset.config,
          scope: previewData.scope,
          ohMyOpenAgent: previewData.preset.ohMyOpenAgent,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      set({ applying: false, applyingId: null, previewData: null });
      return true;
    } catch (err) {
      set({
        applying: false,
        applyingId: null,
        error: err instanceof Error ? err.message : 'Failed to apply preset',
      });
      return false;
    }
  },

  closePreview: () => set({ previewData: null }),

  saveAsPreset: async () => {
    set({ error: null });
    try {
      const resp = await fetch('/api/config/full');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const json = JSON.stringify(data.merged, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'opencode-preset.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to export preset' });
    }
  },
}));
