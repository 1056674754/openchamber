import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { recordVisit, forgetVisit, type BrowserHistoryEntry } from '@/lib/browser/history';
import { normalizePath } from '@/lib/pathNormalization';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';

const MAX_PROJECTS = 20;

type BrowserHistoryState = {
  byProject: Record<string, BrowserHistoryEntry[]>;
  recordVisit: (serverId: string, directory: string, visit: { url: string; title?: string }) => void;
  forget: (serverId: string, directory: string, url: string) => void;
  clear: (serverId: string, directory: string) => void;
};

const projectKey = (serverId: string, directory: string): string => {
  const normalized = normalizePath((directory || '').trim());
  return normalized ? JSON.stringify([getRuntimeKey(), serverId, normalized]) : '';
};

const evictOldestProjects = (
  byProject: Record<string, BrowserHistoryEntry[]>,
): Record<string, BrowserHistoryEntry[]> => {
  const keys = Object.keys(byProject);
  if (keys.length <= MAX_PROJECTS) return byProject;
  return Object.fromEntries(keys
    .map((key) => [key, byProject[key]?.[0]?.lastVisitedAt ?? 0] as const)
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_PROJECTS)
    .map(([key]) => [key, byProject[key] ?? []]));
};

export const useBrowserHistoryStore = create<BrowserHistoryState>()(
  persist(
    (set) => ({
      byProject: {},
      recordVisit: (serverId, directory, visit) => {
        const key = projectKey(serverId, directory);
        if (!key) return;
        set((state) => {
          const current = state.byProject[key] ?? [];
          const next = recordVisit(current, { ...visit, at: Date.now() });
          if (next === current) return state;
          return { byProject: evictOldestProjects({ ...state.byProject, [key]: next }) };
        });
      },
      forget: (serverId, directory, url) => {
        const key = projectKey(serverId, directory);
        if (!key) return;
        set((state) => {
          const current = state.byProject[key];
          if (!current) return state;
          return { byProject: { ...state.byProject, [key]: forgetVisit(current, url) } };
        });
      },
      clear: (serverId, directory) => {
        const key = projectKey(serverId, directory);
        if (!key) return;
        set((state) => {
          if (!(key in state.byProject)) return state;
          const byProject = { ...state.byProject };
          delete byProject[key];
          return { byProject };
        });
      },
    }),
    {
      name: 'openchamber-browser-history',
      version: 1,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => ({ byProject: state.byProject }),
    },
  ),
);

const EMPTY: readonly BrowserHistoryEntry[] = [];
export const selectBrowserHistory = (serverId: string, directory: string) => (
  (state: BrowserHistoryState): readonly BrowserHistoryEntry[] => {
    const key = projectKey(serverId, directory);
    return (key ? state.byProject[key] : undefined) ?? EMPTY;
  }
);
