import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProjectSortOrder } from '@/lib/projectSorting';

export type SessionDisplayMode = 'default' | 'minimal';
export type { ProjectSortOrder } from '@/lib/projectSorting';

type SessionDisplayStore = {
  displayMode: SessionDisplayMode;
  showRecentSection: boolean;
  showArchivedSessions: boolean;
  projectSortOrder: ProjectSortOrder;
  setDisplayMode: (mode: SessionDisplayMode) => void;
  setShowRecentSection: (show: boolean) => void;
  toggleRecentSection: () => void;
  setShowArchivedSessions: (show: boolean) => void;
  toggleArchivedSessions: () => void;
  setProjectSortOrder: (order: ProjectSortOrder) => void;
};

export const migrateSessionDisplayState = (
  persisted: unknown,
  version: number,
): Partial<SessionDisplayStore> => {
  const state = (persisted ?? {}) as Partial<SessionDisplayStore>;
  if (version < 1 && state.projectSortOrder === 'recent') {
    return { ...state, projectSortOrder: 'manual' };
  }
  return state;
};

export const useSessionDisplayStore = create<SessionDisplayStore>()(
  persist(
    (set) => ({
      displayMode: 'default',
      showRecentSection: false,
      showArchivedSessions: false,
      projectSortOrder: 'manual',
      setDisplayMode: (mode) => set({ displayMode: mode }),
      setShowRecentSection: (show) => set({ showRecentSection: show }),
      toggleRecentSection: () => set((state) => ({ showRecentSection: !state.showRecentSection })),
      setShowArchivedSessions: (show) => set({ showArchivedSessions: show }),
      toggleArchivedSessions: () => set((state) => ({ showArchivedSessions: !state.showArchivedSessions })),
      setProjectSortOrder: (order) => set({ projectSortOrder: order }),
    }),
    {
      name: 'session-display-mode',
      version: 1,
      migrate: migrateSessionDisplayState,
    },
  ),
);
