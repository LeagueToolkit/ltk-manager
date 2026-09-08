import { useQuery } from "@tanstack/react-query";

import { hashtableQueries } from "./queries";

/** The state of the shared hashtable cache. */
export function useHashtableCacheStatus() {
  return useQuery(hashtableQueries.cacheStatus());
}
