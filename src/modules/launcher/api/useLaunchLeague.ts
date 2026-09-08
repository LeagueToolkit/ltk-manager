import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type LaunchOutcome, type LaunchTarget } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { launcherKeys } from "./keys";

/**
 * Ask the Riot Client to launch League.
 *
 * Resolves to `null` when the backend was already handling a launch, so callers
 * must not treat a null outcome as a failure.
 */
export function useLaunchLeague() {
  const queryClient = useQueryClient();

  return useMutation<LaunchOutcome | null, AppError, LaunchTarget | undefined>({
    /* usePlay reports the failure through the launch-error toast. */
    meta: { silentError: true },
    mutationFn: async (target) => {
      const result = await api.launchLeague(target);
      return unwrapForQuery(result);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: launcherKeys.availability() });
    },
  });
}
