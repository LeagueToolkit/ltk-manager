export type SortDirection = "asc" | "desc";

/** Which field a list is ordered by, and which way. */
export interface SortConfig<F extends string> {
  field: F;
  direction: SortDirection;
}

/** The three categories a mod or a project is narrowed by, and the order it is drawn in. */
export interface FacetFilterState<F extends string> {
  selectedTags: Set<string>;
  selectedChampions: Set<string>;
  selectedMaps: Set<string>;
  sort: SortConfig<F>;

  toggleTag: (tag: string) => void;
  toggleChampion: (champion: string) => void;
  toggleMap: (map: string) => void;
  setTags: (tags: Set<string>) => void;
  setChampions: (champions: Set<string>) => void;
  setMaps: (maps: Set<string>) => void;
  clearFilters: () => void;
  setSort: (sort: SortConfig<F>) => void;
}

/** The store's own `set`, narrowed to the part of it this slice writes. */
type SetFacets<F extends string> = (
  updater: (state: FacetFilterState<F>) => Partial<FacetFilterState<F>>,
) => void;

function toggled(selected: Set<string>, value: string): Set<string> {
  const next = new Set(selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * The facet half of a list store, spread into the store that owns it.
 *
 * The library and the workshop narrow by the same three categories and differ
 * only in what they sort by, so the sort field is the type parameter.
 */
export function facetFilterSlice<F extends string>(
  defaultSort: SortConfig<F>,
  set: SetFacets<F>,
): FacetFilterState<F> {
  return {
    selectedTags: new Set(),
    selectedChampions: new Set(),
    selectedMaps: new Set(),
    sort: defaultSort,

    toggleTag: (tag) => set((state) => ({ selectedTags: toggled(state.selectedTags, tag) })),
    toggleChampion: (champion) =>
      set((state) => ({ selectedChampions: toggled(state.selectedChampions, champion) })),
    toggleMap: (map) => set((state) => ({ selectedMaps: toggled(state.selectedMaps, map) })),

    setTags: (tags) => set(() => ({ selectedTags: new Set(tags) })),
    setChampions: (champions) => set(() => ({ selectedChampions: new Set(champions) })),
    setMaps: (maps) => set(() => ({ selectedMaps: new Set(maps) })),

    clearFilters: () =>
      set(() => ({
        selectedTags: new Set(),
        selectedChampions: new Set(),
        selectedMaps: new Set(),
      })),

    setSort: (sort) => set(() => ({ sort })),
  };
}

/** The read half of the facets, for a selector that only asks whether they narrow anything. */
interface SelectedFacets {
  selectedTags: ReadonlySet<string>;
  selectedChampions: ReadonlySet<string>;
  selectedMaps: ReadonlySet<string>;
}

/** Whether any of the three categories narrows the list. */
export function hasActiveFacets(state: SelectedFacets): boolean {
  return (
    state.selectedTags.size > 0 || state.selectedChampions.size > 0 || state.selectedMaps.size > 0
  );
}

/** Every facet action at once, on identities the store never replaces. */
export function facetFilterActions<F extends string>(state: FacetFilterState<F>) {
  return {
    toggleTag: state.toggleTag,
    toggleChampion: state.toggleChampion,
    toggleMap: state.toggleMap,
    setTags: state.setTags,
    setChampions: state.setChampions,
    setMaps: state.setMaps,
    clearFilters: state.clearFilters,
    setSort: state.setSort,
  };
}
