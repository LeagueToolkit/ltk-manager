import { useMutation } from "@tanstack/react-query";

import { patcherMutations } from "./mutations";

/**
 * Force a full rebuild of the active profile's overlay.
 *
 * The escape hatch for a stale or incorrectly-built overlay the incremental
 * builder would otherwise reuse.
 */
export function useRebuildOverlay() {
  return useMutation(patcherMutations.rebuildOverlay());
}
