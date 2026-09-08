import { useMutation, useQueryClient } from "@tanstack/react-query";

import { incidentMutations } from "./mutations";

/** Mark every incident dismissed in one round trip, optimistically. */
export function useDismissAllIncidents() {
  return useMutation(incidentMutations.dismissAll(useQueryClient()));
}
