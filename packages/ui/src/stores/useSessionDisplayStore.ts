import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SessionDisplayMode = 'default' | 'minimal';

type SessionDisplayStore = {
  displayMode: SessionDisplayMode;
  showRecentSection: boolean;
  showArchivedSessions: boolean;
  setDisplayMode: (mode: SessionDisplayMode) => void;
  setShowRecentSection: (show: boolean) => void;
  toggleRecentSection: () => void;
  setShowArchivedSessions: (show: boolean) => void;
  toggleArchivedSessions: () => void;
};

export const useSessionDisplayStore = create<SessionDisplayStore>()(
  persist(
    (set) => ({
      displayMode: 'default',
      showRecentSection: false,
      showArchivedSessions: false,
      setDisplayMode: (mode) => set({ displayMode: mode }),
      setShowRecentSection: (show) => set({ showRecentSection: show }),
      toggleRecentSection: () => set((state) => ({ showRecentSection: !state.showRecentSection })),
      setShowArchivedSessions: (show) => set({ showArchivedSessions: show }),
      toggleArchivedSessions: () => set((state) => ({ showArchivedSessions: !state.showArchivedSessions })),
    }),
    {
      name: 'session-display-mode',
    },
  ),
);
