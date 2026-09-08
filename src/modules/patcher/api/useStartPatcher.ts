import { useMutation, useQueryClient } from "@tanstack/react-query";

import { patcherMutations } from "./mutations";

export { startPatcherSpendingQueue } from "./mutations";

/** Start the patcher, spending any queued rebuild. */
export function useStartPatcher() {
  return useMutation(patcherMutations.start(useQueryClient()));
}
