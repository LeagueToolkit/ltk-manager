import { create } from "zustand";

interface LibrarySelectionStore {
  selectMode: boolean;
  selectedIds: Set<string>;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
}

export const useLibrarySelectionStore = create<LibrarySelectionStore>()((set) => ({
  selectMode: false,
  selectedIds: new Set(),
  enterSelectMode: () => set({ selectMode: true }),
  exitSelectMode: () => set({ selectMode: false, selectedIds: new Set() }),
  toggle: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clear: () => set({ selectedIds: new Set() }),
}));
