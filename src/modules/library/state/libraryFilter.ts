import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import {
  facetFilterActions,
  facetFilterSlice,
  type FacetFilterState,
  hasActiveFacets,
  type SortConfig as FacetSortConfig,
  type SortDirection,
} from "@/stores/facetFilter";
import { keepUnversioned, localJsonStorage } from "@/stores/storage";

export type SortField =
  | "priority"
  | "name"
  | "champion"
  | "installedAt"
  | "enabled"
  | "version"
  | "author"
  | "layers"
  | "health"
  | "folder"
  | "format"
  | "storage"
  | "license";
export type SortConfig = FacetSortConfig<SortField>;
export type { SortDirection };

type LibraryFilterStore = FacetFilterState<SortField>;

/**
 * How the library is narrowed and sorted.
 *
 * The sort is per machine and outlives a restart, like the table layout. The facets are
 * session state, because a filter left on reads as a library that lost its mods.
 */
export const useLibraryFilterStore = create<LibraryFilterStore>()(
  persist((set) => facetFilterSlice<SortField>({ field: "priority", direction: "desc" }, set), {
    name: "ltk-library-sort",
    version: 1,
    migrate: keepUnversioned,
    storage: localJsonStorage,
    partialize: (state) => ({ sort: state.sort }),
  }),
);

export function useHasActiveFilters() {
  return useLibraryFilterStore(hasActiveFacets);
}

/** Reordering only applies in the load order. Any other sort imposes its own order. */
export function useReorderDisabled() {
  return useLibraryFilterStore((s) => s.sort.field !== "priority");
}

export const useLibrarySelectedTags = () => useLibraryFilterStore((s) => s.selectedTags);
export const useLibrarySelectedChampions = () => useLibraryFilterStore((s) => s.selectedChampions);
export const useLibrarySelectedMaps = () => useLibraryFilterStore((s) => s.selectedMaps);
export const useLibrarySort = () => useLibraryFilterStore((s) => s.sort);
export const useLibraryFilterActions = () =>
  useLibraryFilterStore(useShallow(facetFilterActions<SortField>));
