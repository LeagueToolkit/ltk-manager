import { useQuery } from "@tanstack/react-query";

import { stringQueries } from "./queries";

/** Current in-game text for override keys, keyed as the caller wrote them. */
export function useGameStringValues(keys: readonly string[]) {
  /* Deduplicated and sorted so the query key is the set of keys, not the
     order the rows happen to hold them in. */
  const wanted = [...new Set(keys.filter((key) => key.trim().length > 0))].sort();

  return useQuery(stringQueries.values(wanted));
}
