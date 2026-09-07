import { useMemo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { useHasActiveFilters } from "@/stores";

import { useFilteredMods } from "./useFilteredMods";

const ROOT_FOLDER_ID = "root";

/**
 * The mods the library is drawing, which is what "all visible" reaches.
 *
 * A search or a filter flattens the folders, so everything that matches is on
 * screen. Without one, a folder route draws that folder alone. These are the
 * branches `useLibraryContent` picks its `ContentView` from, and the two have
 * to agree or Select all reaches mods the reader cannot see.
 */
export function useVisibleMods(
  mods: InstalledMod[],
  searchQuery: string,
  folderId?: string,
): InstalledMod[] {
  const filtered = useFilteredMods(mods, searchQuery);
  const hasActiveFilters = useHasActiveFilters();
  const isFlat = searchQuery.length > 0 || hasActiveFilters;

  return useMemo(() => {
    if (isFlat || !folderId || folderId === ROOT_FOLDER_ID) return filtered;
    return filtered.filter((mod) => mod.folderId === folderId);
  }, [filtered, isFlat, folderId]);
}
