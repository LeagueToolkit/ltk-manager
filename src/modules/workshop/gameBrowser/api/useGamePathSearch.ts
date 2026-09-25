import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";
import type { SearchPreference } from "@/lib/tauri";

import { gameQueries } from "./queries";
import { SEARCH_DEBOUNCE_MS } from "./useGameSearch";

/** The installed game's files ranked for a path field, with the files `preference` names first. */
export function useGamePathSearch(query: string, preference: SearchPreference, enabled: boolean) {
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const active = enabled && debounced.trim().length > 0;

  return useQuery(gameQueries.paths(debounced, preference, active));
}
