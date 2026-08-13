import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistentJsonStorage } from "./storage";

export type WorkshopSortField = "name" | "lastModified";
export type WorkshopSortDirection = "asc" | "desc";

export interface WorkshopSortConfig {
  field: WorkshopSortField;
  direction: WorkshopSortDirection;
}

interface WorkshopFilterStore {
  selectedTags: Set<string>;
  selectedChampions: Set<string>;
  selectedMaps: Set<string>;
  sort: WorkshopSortConfig;

  toggleTag: (tag: string) => void;
  toggleChampion: (champion: string) => void;
  toggleMap: (map: string) => void;
  setTags: (tags: Set<string>) => void;
  setChampions: (champions: Set<string>) => void;
  setMaps: (maps: Set<string>) => void;
  clearFilters: () => void;
  setSort: (sort: WorkshopSortConfig) => void;
}

export const useWorkshopFilterStore = create<WorkshopFilterStore>()(
  persist(
    (set) => ({
      selectedTags: new Set(),
      selectedChampions: new Set(),
      selectedMaps: new Set(),
      sort: { field: "name", direction: "asc" },

      toggleTag: (tag) =>
        set((state) => {
          const next = new Set(state.selectedTags);
          if (next.has(tag)) next.delete(tag);
          else next.add(tag);
          return { selectedTags: next };
        }),

      toggleChampion: (champion) =>
        set((state) => {
          const next = new Set(state.selectedChampions);
          if (next.has(champion)) next.delete(champion);
          else next.add(champion);
          return { selectedChampions: next };
        }),

      toggleMap: (map) =>
        set((state) => {
          const next = new Set(state.selectedMaps);
          if (next.has(map)) next.delete(map);
          else next.add(map);
          return { selectedMaps: next };
        }),

      setTags: (tags) => set({ selectedTags: new Set(tags) }),
      setChampions: (champions) => set({ selectedChampions: new Set(champions) }),
      setMaps: (maps) => set({ selectedMaps: new Set(maps) }),

      clearFilters: () =>
        set({
          selectedTags: new Set(),
          selectedChampions: new Set(),
          selectedMaps: new Set(),
        }),

      setSort: (sort) => set({ sort }),
    }),
    {
      name: "ltk-workshop-filters",
      storage: persistentJsonStorage,
    },
  ),
);

export function useHasActiveWorkshopFilters() {
  return useWorkshopFilterStore(
    (s) => s.selectedTags.size > 0 || s.selectedChampions.size > 0 || s.selectedMaps.size > 0,
  );
}
