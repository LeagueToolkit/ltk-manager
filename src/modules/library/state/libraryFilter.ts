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

export type SortField = "priority" | "name" | "champion" | "installedAt" | "enabled";
export type SortConfig = FacetSortConfig<SortField>;
export type { SortDirection };

type LibraryFilterStore = FacetFilterState<SortField>;

export const useLibraryFilterStore = create<LibraryFilterStore>()((set) =>
  facetFilterSlice<SortField>({ field: "priority", direction: "desc" }, set),
);

export function useHasActiveFilters() {
  return useLibraryFilterStore(hasActiveFacets);
}

/** Reordering only applies in priority sort. Any other sort imposes its own order. */
export function useReorderDisabled() {
  return useLibraryFilterStore((s) => s.sort.field !== "priority");
}

export const useLibrarySelectedTags = () => useLibraryFilterStore((s) => s.selectedTags);
export const useLibrarySelectedChampions = () => useLibraryFilterStore((s) => s.selectedChampions);
export const useLibrarySelectedMaps = () => useLibraryFilterStore((s) => s.selectedMaps);
export const useLibrarySort = () => useLibraryFilterStore((s) => s.sort);
export const useLibraryFilterActions = () =>
  useLibraryFilterStore(useShallow(facetFilterActions<SortField>));
