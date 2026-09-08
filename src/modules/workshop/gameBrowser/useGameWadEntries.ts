import { useQuery } from "@tanstack/react-query";

import { gameQueries } from "./queries";

/** One archive's entries as source entries. Pass null while the archive is unresolved. */
export function useGameWadEntries(wadName: string | null) {
  return useQuery(gameQueries.wadEntries(wadName));
}
