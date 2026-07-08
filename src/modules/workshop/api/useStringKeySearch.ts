import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useDebouncedValue } from "@/hooks";
import { api, type AppError, type StringKeySearchResult } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/**
 * Autocomplete suggestions for stringtable field names.
 *
 * Debounces the query and keeps the previous suggestions visible while the
 * next set loads. The first request builds the backend index (downloading the
 * key list when needed), so it can take a few seconds.
 */
export function useStringKeySearch(query: string, enabled = true) {
  const debouncedQuery = useDebouncedValue(query.trim().toLowerCase());

  return useQuery<StringKeySearchResult, AppError>({
    queryKey: ["string-key-search", debouncedQuery],
    queryFn: async () => {
      const result = await api.searchStringKeys(debouncedQuery, 50);
      return unwrapForQuery(result);
    },
    enabled,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
