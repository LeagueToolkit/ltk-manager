import { useMemo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { useChampionRoster } from "@/modules/champions/api";
import { type EffectiveCategories, type SortContext, sortMods } from "@/modules/library/utils";

import {
  useLibrarySelectedChampions,
  useLibrarySelectedMaps,
  useLibrarySelectedTags,
  useLibrarySort,
} from "../state";
import { useModHealthVerdicts } from "./modHealth";
import { useFolders } from "./queries";
import { useEffectiveCategories } from "./useEffectiveCategories";

/**
 * What the sort reads beyond a mod, for the fields another query answers.
 *
 * `effective` is what the filters and the table group by, so the champion sort files a
 * mod under the same champions they do.
 */
export function useSortContext(effective: Map<string, EffectiveCategories>): SortContext {
  const { data: folders } = useFolders();
  const { data: verdicts } = useModHealthVerdicts();

  return useMemo(() => {
    const names = new Map((folders ?? []).map((folder) => [folder.id, folder.name]));
    return {
      folderName: (folderId) => names.get(folderId),
      healthOf: (modId) => verdicts?.[modId] ?? null,
      championsOf: (mod) => effective.get(mod.id)?.champions ?? mod.champions,
    };
  }, [folders, verdicts, effective]);
}

export function useFilteredMods(mods: InstalledMod[], searchQuery: string): InstalledMod[] {
  const selectedTags = useLibrarySelectedTags();
  const selectedChampions = useLibrarySelectedChampions();
  const selectedMaps = useLibrarySelectedMaps();
  const sort = useLibrarySort();
  const effective = useEffectiveCategories(mods);
  const roster = useChampionRoster();
  const sortContext = useSortContext(effective);

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
      const championKeys = new Set([...selectedChampions].map(roster.keyOf));
      result = result.filter((mod) =>
        (effective.get(mod.id)?.champions ?? mod.champions).some((c) =>
          championKeys.has(roster.keyOf(c)),
        ),
      );
    }
    if (selectedMaps.size > 0) {
      result = result.filter((mod) =>
        (effective.get(mod.id)?.maps ?? mod.maps).some((m) => selectedMaps.has(m)),
      );
    }

    return sortMods(result, sort, sortContext);
  }, [
    mods,
    searchQuery,
    selectedTags,
    selectedChampions,
    selectedMaps,
    sort,
    effective,
    roster,
    sortContext,
  ]);
}
