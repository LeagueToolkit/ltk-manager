import { useMutation, useQueryClient } from "@tanstack/react-query";

import { incidentMutations } from "./mutations";

/** Mark an incident dismissed, optimistically. */
export function useDismissIncident() {
  return useMutation(incidentMutations.dismiss(useQueryClient()));
}
