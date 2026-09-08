import { useMutation, useQueryClient } from "@tanstack/react-query";

import { hashtableMutations } from "./mutations";

/** Sync the shared hashtable cache. Pass `true` to re-download every table. */
export function useSyncHashtables() {
  return useMutation(hashtableMutations.sync(useQueryClient()));
}
