import { create } from 'zustand';

export interface BtwPanelUIState {
  collapsed?: boolean;
  creating?: boolean;
  destroying?: boolean;
}

interface BtwStore {
  byParent: Record<string, BtwPanelUIState>;
  setPanelState: (parentSessionId: string, patch: BtwPanelUIState) => void;
  clearPanelState: (parentSessionId: string) => void;
}

/**
 * Presentation-only state. Panel identity lives in parent/fork Session
 * metadata, so navigation, reload and multi-directory routing stay
 * authoritative even when this transient store is empty.
 */
export const useBtwStore = create<BtwStore>((set) => ({
  byParent: {},
  setPanelState: (parentSessionId, patch) => set((state) => ({
    byParent: {
      ...state.byParent,
      [parentSessionId]: { ...state.byParent[parentSessionId], ...patch },
    },
  })),
  clearPanelState: (parentSessionId) => set((state) => {
    if (!(parentSessionId in state.byParent)) return state;
    const byParent = { ...state.byParent };
    delete byParent[parentSessionId];
    return { byParent };
  }),
}));
