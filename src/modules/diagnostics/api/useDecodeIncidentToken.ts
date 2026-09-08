import { useMutation } from "@tanstack/react-query";

import { incidentMutations } from "./mutations";

/** Unfold a pasted token into the incident it carries, read against this build's tables. */
export function useDecodeIncidentToken() {
  return useMutation(incidentMutations.decodeToken());
}
