import { useQuery } from "@tanstack/react-query";

import { modQueries } from "./queries";

/** Every cached WAD footprint report, in one IPC call. */
export function useAllModWadReports() {
  return useQuery(modQueries.wadReports());
}

/**
 * The cached WAD footprint report for one mod.
 *
 * Null for a mod that has never been analyzed nor included in a successful patch
 * run. Reads from the shared batch query, so no extra IPC call.
 */
export function useModWadReport(modId: string) {
  return useQuery({
    ...modQueries.wadReports(),
    select: (reports) => reports[modId] ?? null,
  });
}
