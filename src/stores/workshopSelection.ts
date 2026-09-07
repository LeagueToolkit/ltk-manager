import { create } from "zustand";
import { persist } from "zustand/middleware";

import { sessionJsonStorage } from "./storage";

interface WorkshopSelectionStore {
  selectedPaths: Set<string>;
  toggle: (path: string) => void;
  /** Drops the rest and keeps this one, which is what a right click outside the selection does. */
  selectOnly: (path: string) => void;
  selectAll: (paths: string[]) => void;
  clear: () => void;
}

export const useWorkshopSelectionStore = create<WorkshopSelectionStore>()(
  persist(
    (set) => ({
      selectedPaths: new Set(),
      toggle: (path) =>
        set((state) => {
          const next = new Set(state.selectedPaths);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return { selectedPaths: next };
        }),
      selectOnly: (path) => set({ selectedPaths: new Set([path]) }),
      selectAll: (paths) => set({ selectedPaths: new Set(paths) }),
      clear: () => set({ selectedPaths: new Set() }),
    }),
    {
      name: "workshop-selection",
      storage: sessionJsonStorage,
    },
  ),
);
