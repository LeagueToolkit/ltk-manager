import { useMutation, useQueryClient } from "@tanstack/react-query";

import { keptSortMutations } from "./keptSortMutations";

/** Set the sort some folders keep their load order in, or return them to manual order. */
export function useSetKeptSort() {
  return useMutation(keptSortMutations.set(useQueryClient()));
}
