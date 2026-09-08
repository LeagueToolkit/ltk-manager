import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

/**
 * Current in-game text for override keys, keyed as the caller wrote them.
 *
 * A key the game does not resolve is simply absent, and the editor shows no
 * original line for it. The backend shares the suggestion index, so the first
 * call of a session can take a few seconds while that index builds.
 */
export function useGameStringValues(keys: readonly string[]) {
  /* Deduplicated and sorted so the query key is the set of keys, not the
     order the rows happen to hold them in. */
  const wanted = [...new Set(keys.filter((key) => key.trim().length > 0))].sort();

  return useQuery<Record<string, string>, AppError>({
    queryKey: workshopKeys.stringValues(wanted),
    queryFn: async () => {
      const result = await api.lookupStringValues(wanted);
      return unwrapForQuery(result);
    },
    enabled: wanted.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
