import { useQuery } from "@tanstack/react-query";

import { modQueries } from "./queries";

/**
 * The checksum mismatches the most recent overlay build found in one mod.
 *
 * A mismatch marks a badly-packed archive: its container claimed a checksum its
 * own bytes do not have. Advisory only, because the overlay carries the
 * recomputed value and the mod still works. Empty when the mod's containers told
 * the truth, or the mod was not part of the last build. Reads from a shared
 * batch query, so many subscribers is a single IPC call.
 */
export function useModChecksumMismatches(modId: string) {
  return useQuery({
    ...modQueries.checksumMismatches(),
    select: (mismatches) => mismatches[modId] ?? [],
  });
}
