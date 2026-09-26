import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";
import type { SearchPreference } from "@/lib/tauri";

import { gameQueries } from "./queries";
import { SEARCH_DEBOUNCE_MS } from "./useGameSearch";

/**
 * The installed game's files ranked for a path field, with the files `preference` names first.
 *
 * `searching` holds from the keystroke, through the debounce, until the answer for `query` lands.
 */
export function useGamePathSearch(query: string, preference: SearchPreference, enabled: boolean) {
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const active = enabled && debounced.trim().length > 0;
  const search = useQuery(gameQueries.paths(debounced, preference, active));
  const waiting = enabled && query.trim().length > 0 && debounced !== query;

  return { data: search.data, searching: waiting || search.isFetching };
}
