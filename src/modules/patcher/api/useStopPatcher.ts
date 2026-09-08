import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patcherMutations } from "./mutations";

/**
 * Ask the patcher to stop.
 *
 * The shared `stopping` flag is raised by the mutation and lowered by
 * `useClearStoppingOnIdle` once the session actually ends.
 */
export function useStopPatcher() {
  return useMutation(patcherMutations.stop(useQueryClient()));
}
