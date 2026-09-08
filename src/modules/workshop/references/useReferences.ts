import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";

import { api, type AppError, type ObjectReferences, type ReferenceQuery } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

/* The leaves rather than the browsers' barrels, which reach this module back through
   the documents registry mid-evaluation, their keys unbound. */
import { gameKeys } from "../gameBrowser/useGameWads";
import { BUILDING_POLL_MS } from "../gameBrowser/useObjectIndex";
import type { ReferenceRequest } from "../state";

export const referenceKeys = {
  /* Under the object searches. The invalidation of a warm or a drop asks again. */
  all: [...gameKeys.objectSearches, "references"] as const,
  query: (query: ReferenceQuery | null) =>
    [...gameKeys.objectSearches, "references", query] as const,
};

/**
 * What one question asks the index for, in the slot the index is in.
 *
 * An answer the build has not given asks again each second. The previous answer stays
 * on screen while the next one arrives.
 */
export function useReferences(request: ReferenceRequest | null) {
  return useQuery<ObjectReferences, AppError>({
    queryKey: referenceKeys.query(request?.query ?? null),
    queryFn: request ? queryFnWithArgs(api.findReferences, request.query) : skipToken,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "building" || status === "absent" ? BUILDING_POLL_MS : false;
    },
    staleTime: 0,
    gcTime: 0,
  });
}
