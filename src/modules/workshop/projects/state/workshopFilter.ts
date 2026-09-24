import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import {
  facetFilterActions,
  facetFilterSlice,
  type FacetFilterState,
  hasActiveFacets,
  type SortConfig as FacetSortConfig,
  type SortDirection,
} from "@/stores/facetFilter";

/** How the workshop draws its projects, as cards or as rows. */
export type ViewMode = "grid" | "list";

export type WorkshopSortField = "name" | "lastModified" | "lastOpened";

/** Which projects the grid lists by where they live. */
export type WorkshopLocationFilter = "all" | "workshop" | "opened";
export type WorkshopSortDirection = SortDirection;
export type WorkshopSortConfig = FacetSortConfig<WorkshopSortField>;

interface WorkshopFilterStore extends FacetFilterState<WorkshopSortField> {
  viewMode: ViewMode;
  searchQuery: string;
  location: WorkshopLocationFilter;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
  setLocation: (location: WorkshopLocationFilter) => void;
}

export const useWorkshopFilterStore = create<WorkshopFilterStore>()((set) => {
  const facets = facetFilterSlice<WorkshopSortField>(
    { field: "lastOpened", direction: "desc" },
    set,
  );

  return {
    ...facets,
    /* The location is a facet like the others, so clearing them clears it too. */
    clearFilters: () => {
      facets.clearFilters();
      set({ location: "all" });
    },

    viewMode: "grid",
    searchQuery: "",
    location: "all",
    setViewMode: (mode) => set({ viewMode: mode }),
    setSearchQuery: (query) => set({ searchQuery: query }),
    setLocation: (location) => set({ location }),
  };
});

export function useHasActiveWorkshopFilters() {
  return useWorkshopFilterStore((s) => hasActiveFacets(s) || s.location !== "all");
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
export const useWorkshopLocation = () => useWorkshopFilterStore((s) => s.location);
export const useSetWorkshopLocation = () => useWorkshopFilterStore((s) => s.setLocation);
export const useWorkshopFilterActions = () =>
  useWorkshopFilterStore(useShallow(facetFilterActions<WorkshopSortField>));
