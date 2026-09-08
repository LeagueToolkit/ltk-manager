import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

/** How the workshop draws its projects, as cards or as rows. */
export type ViewMode = "grid" | "list";

export type WorkshopSortField = "name" | "lastModified";
export type WorkshopSortDirection = "asc" | "desc";

export interface WorkshopSortConfig {
  field: WorkshopSortField;
  direction: WorkshopSortDirection;
}

interface WorkshopFilterStore {
  viewMode: ViewMode;
  searchQuery: string;
  selectedTags: Set<string>;
  selectedChampions: Set<string>;
  selectedMaps: Set<string>;
  sort: WorkshopSortConfig;

  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  toggleTag: (tag: string) => void;
  toggleChampion: (champion: string) => void;
  toggleMap: (map: string) => void;
  setTags: (tags: Set<string>) => void;
  setChampions: (champions: Set<string>) => void;
  setMaps: (maps: Set<string>) => void;
  clearFilters: () => void;
  setSort: (sort: WorkshopSortConfig) => void;
}

export const useWorkshopFilterStore = create<WorkshopFilterStore>((set) => ({
  viewMode: "grid",
  searchQuery: "",
  selectedTags: new Set(),
  selectedChampions: new Set(),
  selectedMaps: new Set(),
  sort: { field: "name", direction: "asc" },

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),

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
}));

export function useHasActiveWorkshopFilters() {
  return useWorkshopFilterStore(
    (s) => s.selectedTags.size > 0 || s.selectedChampions.size > 0 || s.selectedMaps.size > 0,
  );
}

export const useWorkshopViewMode = () => useWorkshopFilterStore((s) => s.viewMode);
export const useSetWorkshopViewMode = () => useWorkshopFilterStore((s) => s.setViewMode);
export const useWorkshopSearchQuery = () => useWorkshopFilterStore((s) => s.searchQuery);
export const useSetWorkshopSearchQuery = () => useWorkshopFilterStore((s) => s.setSearchQuery);
export const useWorkshopSelectedTags = () => useWorkshopFilterStore((s) => s.selectedTags);
export const useWorkshopSelectedChampions = () =>
  useWorkshopFilterStore((s) => s.selectedChampions);
export const useWorkshopSelectedMaps = () => useWorkshopFilterStore((s) => s.selectedMaps);
export const useWorkshopSort = () => useWorkshopFilterStore((s) => s.sort);

/** Every filter action at once, on identities the store never replaces. */
export const useWorkshopFilterActions = () =>
  useWorkshopFilterStore(
    useShallow((s) => ({
      toggleTag: s.toggleTag,
      toggleChampion: s.toggleChampion,
      toggleMap: s.toggleMap,
      setTags: s.setTags,
      setChampions: s.setChampions,
      setMaps: s.setMaps,
      clearFilters: s.clearFilters,
      setSort: s.setSort,
    })),
  );
