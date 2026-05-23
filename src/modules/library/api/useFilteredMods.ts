import { useMemo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { sortMods } from "@/modules/library/utils";
import { useLibraryFilterStore } from "@/stores";

export function useFilteredMods(mods: InstalledMod[], searchQuery: string): InstalledMod[] {
  const { selectedTags, selectedChampions, selectedMaps, showOnlyEnabled, sort } =
    useLibraryFilterStore();

  return useMemo(() => {
    let result = mods;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (mod) => mod.displayName.toLowerCase().includes(q) || mod.name.toLowerCase().includes(q),
      );
    }

    if (showOnlyEnabled) {
      result = result.filter((mod) => mod.enabled);
    }

    if (selectedTags.size > 0) {
      result = result.filter((mod) => mod.tags.some((t) => selectedTags.has(t)));
    }
    if (selectedChampions.size > 0) {
      result = result.filter((mod) => mod.champions.some((c) => selectedChampions.has(c)));
    }
    if (selectedMaps.size > 0) {
      result = result.filter((mod) => mod.maps.some((m) => selectedMaps.has(m)));
    }

    return sortMods(result, sort);
  }, [mods, searchQuery, selectedTags, selectedChampions, selectedMaps, showOnlyEnabled, sort]);
}
