import { create } from 'zustand';

type StickyHeadersState = {
  stuckIds: Set<string>;
  setStuck: (id: string, stuck: boolean) => void;
  clearAll: () => void;
};

export const useStickyHeadersStore = create<StickyHeadersState>((set) => ({
  stuckIds: new Set(),
  setStuck: (id, stuck) =>
    set((state) => {
      if (state.stuckIds.has(id) === stuck) return state;
      const next = new Set(state.stuckIds);
      if (stuck) next.add(id);
      else next.delete(id);
      return { stuckIds: next };
    }),
  clearAll: () =>
    set((state) => (state.stuckIds.size === 0 ? state : { stuckIds: new Set() })),
}));
