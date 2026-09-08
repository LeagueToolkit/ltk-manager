import { useMutation } from "@tanstack/react-query";

import { incidentMutations } from "./mutations";

/** Reveal an incident's `r3dlog` in the file manager. Fails for an incident with no log. */
export function useRevealGameLog() {
  return useMutation(incidentMutations.revealGameLog());
}
