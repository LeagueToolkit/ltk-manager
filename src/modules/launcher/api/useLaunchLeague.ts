import { useMutation, useQueryClient } from "@tanstack/react-query";

import { launchMutations } from "./mutations";

/**
 * Ask the Riot Client to launch League.
 *
 * Resolves to `null` when the backend was already handling a launch, so callers
 * must not treat a null outcome as a failure.
 */
export function useLaunchLeague() {
  return useMutation(launchMutations.launch(useQueryClient()));
}
