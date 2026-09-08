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

export type WorkshopSortField = "name" | "lastModified";
export type WorkshopSortDirection = SortDirection;
export type WorkshopSortConfig = FacetSortConfig<WorkshopSortField>;

interface WorkshopFilterStore extends FacetFilterState<WorkshopSortField> {
  viewMode: ViewMode;
  searchQuery: string;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
}

export const useWorkshopFilterStore = create<WorkshopFilterStore>()((set) => ({
  ...facetFilterSlice<WorkshopSortField>({ field: "name", direction: "asc" }, set),

  viewMode: "grid",
  searchQuery: "",
  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));

export function useHasActiveWorkshopFilters() {
  return useWorkshopFilterStore(hasActiveFacets);
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
export const useWorkshopFilterActions = () =>
  useWorkshopFilterStore(useShallow(facetFilterActions<WorkshopSortField>));
