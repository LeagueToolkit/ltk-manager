import { useQuery } from "@tanstack/react-query";

import { modQueries } from "./queries";

/**
 * The linked-bin offenders of the most recent overlay build, in one IPC call.
 *
 * Keyed by mod id. A mod absent from the map has no unresolved dependencies, or
 * was not part of the last build. A cheap read, with no overlay build behind it.
 */
export function useLinkedBinOffenders() {
  return useQuery(modQueries.linkedBinOffenders());
}

/**
 * The linked-bin offender entry for one mod.
 *
 * Null when the mod had no unresolved dependencies in the last build. Reads from
 * the shared batch query, so many mod cards subscribing is a single IPC call.
 */
export function useLinkedBinOffender(modId: string) {
  return useQuery({
    ...modQueries.linkedBinOffenders(),
    select: (offenders) => offenders[modId] ?? null,
  });
}
