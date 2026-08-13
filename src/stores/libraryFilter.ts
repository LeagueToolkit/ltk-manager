import { create } from "zustand";
import { persist } from "zustand/middleware";

import { persistentJsonStorage } from "./storage";

export type SortField = "priority" | "name" | "installedAt" | "enabled";
export type SortDirection = "asc" | "desc";

export interface SortConfig {
  field: SortField;
  direction: SortDirection;
}

interface LibraryFilterStore {
  selectedTags: Set<string>;
  selectedChampions: Set<string>;
  selectedMaps: Set<string>;
  showOnlyEnabled: boolean;
  sort: SortConfig;
  searchQuery: string;

  toggleTag: (tag: string) => void;
  toggleChampion: (champion: string) => void;
  toggleMap: (map: string) => void;
  setTags: (tags: Set<string>) => void;
  setChampions: (champions: Set<string>) => void;
  setMaps: (maps: Set<string>) => void;
  clearFilters: () => void;
  setShowOnlyEnabled: (show: boolean) => void;
  setSort: (sort: SortConfig) => void;
  setSearchQuery: (query: string) => void;
}

export const useLibraryFilterStore = create<LibraryFilterStore>()(
  persist(
    (set) => ({
      selectedTags: new Set(),
      selectedChampions: new Set(),
      selectedMaps: new Set(),
      showOnlyEnabled: false,
      sort: { field: "enabled", direction: "asc" },
      searchQuery: "",

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
          showOnlyEnabled: false,
        }),

      setShowOnlyEnabled: (show) => set({ showOnlyEnabled: show }),
      setSort: (sort) => set({ sort }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
    }),
    {
      name: "ltk-library-filters",
      storage: persistentJsonStorage,
    },
  ),
);

export function useHasActiveFilters() {
  return useLibraryFilterStore(
    (s) =>
      s.selectedTags.size > 0 ||
      s.selectedChampions.size > 0 ||
      s.selectedMaps.size > 0 ||
      s.showOnlyEnabled,
  );
}

/** Reordering only applies in priority sort; any other sort imposes its own order. */
export function useReorderDisabled() {
  return useLibraryFilterStore((s) => s.sort.field !== "priority");
}
