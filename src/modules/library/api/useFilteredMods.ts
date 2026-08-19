import { useMemo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { sortMods } from "@/modules/library/utils";
import { useLibraryFilterStore } from "@/stores";

import { useEffectiveCategories } from "./useEffectiveCategories";

export function useFilteredMods(mods: InstalledMod[], searchQuery: string): InstalledMod[] {
  const { selectedTags, selectedChampions, selectedMaps, sort } = useLibraryFilterStore();
  const effective = useEffectiveCategories(mods);

  return useMemo(() => {
    let result = mods;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (mod) => mod.displayName.toLowerCase().includes(q) || mod.name.toLowerCase().includes(q),
      );
    }

    // Match against declared OR footprint-derived values via effective categories.
    if (selectedTags.size > 0) {
      result = result.filter((mod) =>
        (effective.get(mod.id)?.tags ?? mod.tags).some((t) => selectedTags.has(t)),
      );
    }
    if (selectedChampions.size > 0) {
      result = result.filter((mod) =>
        (effective.get(mod.id)?.champions ?? mod.champions).some((c) => selectedChampions.has(c)),
      );
    }
    if (selectedMaps.size > 0) {
      result = result.filter((mod) =>
        (effective.get(mod.id)?.maps ?? mod.maps).some((m) => selectedMaps.has(m)),
      );
    }

    return sortMods(result, sort);
  }, [mods, searchQuery, selectedTags, selectedChampions, selectedMaps, sort, effective]);
}
