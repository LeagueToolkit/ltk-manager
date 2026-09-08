import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";

import { objectIndexQueries } from "./queries";
import { SEARCH_DEBOUNCE_MS } from "./useGameSearch";

/**
 * Rank every bin object of the install against `query`.
 *
 * The answer carries the slot the index is in, so a query typed while the
 * build runs reads as building rather than as nothing.
 */
export function useObjectSearch(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const active = enabled && debounced.trim().length > 0;

  return useQuery(objectIndexQueries.search(debounced, active));
}
