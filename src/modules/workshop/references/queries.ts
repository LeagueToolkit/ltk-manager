import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import { api, type AppError, type ObjectReferences, type ReferenceQuery } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

/* The leaves rather than the browsers' barrels, which reach this module back through
   the documents registry mid-evaluation, their keys unbound. */
import { BUILDING_POLL_MS, gameKeys } from "../gameBrowser/keys";

export const referenceKeys = {
  /* Under the object searches. The invalidation of a warm or a drop asks again. */
  all: [...gameKeys.objectSearches, "references"] as const,
  query: (query: ReferenceQuery | null) =>
    [...gameKeys.objectSearches, "references", query] as const,
};

/** What the index answers about who points at an object. */
export const referenceQueries = {
  /* An answer the build has not given asks again each second. The previous answer
     stays on screen while the next one arrives. */
  forQuery: (query: ReferenceQuery | null) =>
    queryOptions<ObjectReferences, AppError>({
      queryKey: referenceKeys.query(query),
      queryFn: query ? queryFnWithArgs(api.findReferences, query) : skipToken,
      placeholderData: keepPreviousData,
      refetchInterval: (result) => {
        const status = result.state.data?.status;
        return status === "building" || status === "absent" ? BUILDING_POLL_MS : false;
      },
      staleTime: 0,
      gcTime: 0,
    }),
} as const;
