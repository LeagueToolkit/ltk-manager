import { useQuery } from "@tanstack/react-query";

import { hashtableQueries } from "./queries";

/** The shared hashtable cache compared against the latest published release. */
export function useHashtableUpdateCheck() {
  return useQuery(hashtableQueries.updateCheck());
}
