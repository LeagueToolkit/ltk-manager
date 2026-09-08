import { useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";

import { stringQueries } from "./queries";

/**
 * Autocomplete suggestions for stringtable field names.
 *
 * Debounces the query and keeps the previous suggestions visible while the
 * next set loads.
 */
export function useStringKeySearch(query: string, enabled = true) {
  const debouncedQuery = useDebouncedValue(query.trim().toLowerCase());

  return useQuery({ ...stringQueries.keySearch(debouncedQuery), enabled });
}
