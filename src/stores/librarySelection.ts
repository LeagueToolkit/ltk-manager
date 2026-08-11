import { create } from "zustand";

interface LibrarySelectionStore {
  selectMode: boolean;
  selectedIds: Set<string>;
  /** Visual order of the currently selectable mod ids, used to resolve shift-click ranges. */
  orderedIds: string[];
  /** Id of the last mod toggled without shift — the anchor for range selection. */
  anchorId: string | null;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  setOrderedIds: (ids: string[]) => void;
  toggle: (id: string) => void;
  selectRangeTo: (id: string) => void;
  addMany: (ids: string[]) => void;
  removeMany: (ids: string[]) => void;
  setSelection: (ids: Iterable<string>) => void;
  clear: () => void;
}

export const useLibrarySelectionStore = create<LibrarySelectionStore>()((set) => ({
  selectMode: false,
  selectedIds: new Set(),
  orderedIds: [],
  anchorId: null,
  enterSelectMode: () => set((state) => (state.selectMode ? state : { selectMode: true })),
  exitSelectMode: () => set({ selectMode: false, selectedIds: new Set(), anchorId: null }),
  setOrderedIds: (ids) =>
    set((state) => (sameOrder(state.orderedIds, ids) ? state : { orderedIds: ids })),
  toggle: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next, anchorId: id };
    }),
  selectRangeTo: (id) =>
    set((state) => {
      const { orderedIds, anchorId } = state;
      const from = anchorId === null ? -1 : orderedIds.indexOf(anchorId);
      const to = orderedIds.indexOf(id);
      const next = new Set(state.selectedIds);
      if (from === -1 || to === -1) {
        next.add(id);
        return { selectedIds: next, anchorId: id };
      }
      const [start, end] = from <= to ? [from, to] : [to, from];
      for (let i = start; i <= end; i++) next.add(orderedIds[i]);
      return { selectedIds: next, anchorId: id };
    }),
  addMany: (ids) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      if (!changed) return state;
      return { selectedIds: next };
    }),
  removeMany: (ids) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      let changed = false;
      for (const id of ids) changed = next.delete(id) || changed;
      if (!changed) return state;
      return { selectedIds: next };
    }),
  setSelection: (ids) => set({ selectedIds: new Set(ids), anchorId: null }),
  clear: () =>
    set((state) =>
      state.selectedIds.size === 0 && state.anchorId === null
        ? state
        : { selectedIds: new Set(), anchorId: null },
    ),
}));

function sameOrder(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
