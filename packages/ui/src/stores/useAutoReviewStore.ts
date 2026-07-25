import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import { DEFAULT_SERVER_ID, serverRegistry } from '@/lib/opencode/server-registry';

type AutoReviewPhase = 'waiting_for_reviewer' | 'waiting_for_implementer';
type AutoReviewStatus = 'running' | 'completed' | 'stopped' | 'error';

export type AutoReviewRun = {
  originalSessionID: string;
  reviewSessionID: string;
  directory: string;
  serverId: string;
  status: AutoReviewStatus;
  phase: AutoReviewPhase;
  iteration: number;
  maxIterations: number;
  lastForwardedMessageID?: string;
  expectedAssistantParentID?: string;
  waitAfterCreatedAt?: number;
  error?: string;
};

type AutoReviewState = {
  runsByOriginalSessionID: Record<string, AutoReviewRun>;
  upsertRun: (run: AutoReviewRun) => void;
  updateRun: (originalSessionID: string, updater: (run: AutoReviewRun) => AutoReviewRun) => void;
  stopRun: (originalSessionID: string) => void;
  completeRun: (originalSessionID: string) => void;
  stopRunningRunsForServer: (serverId: string) => void;
  isRunningForSession: (sessionID: string) => boolean;
};

const isServerAvailable = (serverId: string): boolean => {
  if (!serverId) return false;
  if (serverId === DEFAULT_SERVER_ID) return true;
  return serverRegistry.has(serverId);
};

export const useAutoReviewStore = create<AutoReviewState>()(
  persist(
    (set, get) => ({
      runsByOriginalSessionID: {},
      upsertRun: (run) => set((state) => ({
        runsByOriginalSessionID: {
          ...state.runsByOriginalSessionID,
          [run.originalSessionID]: run,
        },
      })),
      updateRun: (originalSessionID, updater) => set((state) => {
        const current = state.runsByOriginalSessionID[originalSessionID];
        if (!current) return state;
        return {
          runsByOriginalSessionID: {
            ...state.runsByOriginalSessionID,
            [originalSessionID]: updater(current),
          },
        };
      }),
      stopRun: (originalSessionID) => set((state) => {
        const current = state.runsByOriginalSessionID[originalSessionID];
        if (!current) return state;
        return {
          runsByOriginalSessionID: {
            ...state.runsByOriginalSessionID,
            [originalSessionID]: { ...current, status: 'stopped' },
          },
        };
      }),
      completeRun: (originalSessionID) => set((state) => {
        const current = state.runsByOriginalSessionID[originalSessionID];
        if (!current) return state;
        return {
          runsByOriginalSessionID: {
            ...state.runsByOriginalSessionID,
            [originalSessionID]: { ...current, status: 'completed' },
          },
        };
      }),
      stopRunningRunsForServer: (serverId) => set((state) => {
        let changed = false;
        const next = { ...state.runsByOriginalSessionID };
        for (const [sessionID, run] of Object.entries(next)) {
          if (run.serverId === serverId && run.status === 'running') {
            next[sessionID] = {
              ...run,
              status: 'stopped',
              error: 'Auto-review stopped because the server became unavailable.',
            };
            changed = true;
          }
        }
        return changed ? { runsByOriginalSessionID: next } : state;
      }),
      isRunningForSession: (sessionID) => {
        const run = get().runsByOriginalSessionID[sessionID];
        if (!run || run.status !== 'running') return false;
        return isServerAvailable(run.serverId);
      },
    }),
    {
      name: 'auto-review-store',
      version: 1,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => ({ runsByOriginalSessionID: state.runsByOriginalSessionID }),
    },
  ),
);
