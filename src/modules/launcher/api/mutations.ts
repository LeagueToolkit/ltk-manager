import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type LaunchOutcome, type LaunchTarget } from "@/lib/tauri";
import { usePlaySessionStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { launcherKeys } from "./keys";

/** Writes that ask the Riot Client to start or stop waiting. */
export const launchMutations = {
  /* Answers `null` when the backend was already handling a launch, so a caller
     must not read a null outcome as a failure. */
  launch: (client: QueryClient) =>
    mutationOptions<LaunchOutcome | null, AppError, LaunchTarget | undefined>({
      /* usePlay reports the failure through the launch-error toast. */
      meta: { silentError: true },
      mutationFn: async (target) => unwrapForQuery(await api.launchLeague(target)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: launcherKeys.availability() });
      },
    }),

  /* The backend checks the stop flag between the steps of its wait, so a cancel
     can lag by one in-flight request - which is why the step goes to `cancelling`
     rather than straight back to idle. Stopping abandons the wait and not the
     launch: a request the Riot Client already accepted still starts a game. */
  cancel: () =>
    mutationOptions<boolean, AppError, void>({
      mutationFn: async () => unwrapForQuery(await api.cancelLaunch()),
      onMutate: () => {
        usePlaySessionStore.getState().setStep("cancelling");
      },
    }),
} as const;
