import { useCallback } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import type { AppError, LauncherError } from "@/lib/tauri";

interface LaunchErrorMessage {
  title: string;
  description: string;
}

/**
 * Each launch failure has a different remedy, so each gets its own wording.
 *
 * The `LauncherError` union arrives whole as the error's context, and its
 * `kind` is what tells the failures apart. The code says only that a launch
 * failed, because a code per variant would repeat that discriminant on the
 * wire and be lossier than the context it sat beside.
 *
 * Note what is deliberately absent: nothing offers to start a second Riot
 * Client when the running one is unreachable. Riot's process singleton is an
 * exclusive lock on the lockfile, and a second client that cannot hand off its
 * argv within five seconds kills the first - mid-champion-select, in the worst
 * case. Opening the client by hand is the only safe recovery.
 */
function launchErrorMessage(error: AppError): LaunchErrorMessage {
  const context = error.context as LauncherError | undefined;

  return match(context)
    .with({ kind: "RIOT_CLIENT_NOT_FOUND" }, () => ({
      title: "Can't find your Riot Client",
      description:
        "Check that your League installation path is set correctly in Settings - the manager reads it to work out which Riot Client owns your install.",
    }))
    .with({ kind: "RIOT_CLIENT_UNREACHABLE" }, () => ({
      title: "Couldn't reach the Riot Client",
      description:
        "It's running but didn't accept the launch request. Bring it up manually and try again.",
    }))
    .with({ kind: "LAUNCH_REFUSED" }, (refusal) => refusalMessage(refusal, error.message))
    .with({ kind: "SPAWN_FAILED" }, () => ({
      title: "Couldn't start the Riot Client",
      description:
        "Windows would not start it. An antivirus holding the executable, or a Riot Client that has been moved or removed, are the usual reasons - open it yourself to check.",
    }))
    .with({ kind: "UNSUPPORTED_PLATFORM" }, () => ({
      title: "Launching isn't supported here",
      description: "The manager can only launch League on Windows. Start it from the Riot Client.",
    }))
    .otherwise(() => ({ title: "Couldn't launch League", description: error.message }));
}

/**
 * The Riot Client answered, and its answer is the remedy.
 *
 * The backend already retried these for half a minute, so one arriving here is
 * a standing condition rather than a client that was still waking up - which is
 * why the wording tells the player to go and clear it rather than to try again.
 */
function refusalMessage(
  refusal: Extract<LauncherError, { kind: "LAUNCH_REFUSED" }>,
  fallback: string,
): LaunchErrorMessage {
  if (refusal.riotErrorCode === "eula_not_accepted") {
    return {
      title: "Riot's Terms of Service need accepting",
      description:
        "Open the Riot Client and accept the Terms of Service, then press Play again. The Riot Client won't start League until you have.",
    };
  }

  // Riot's own prose is better than anything generic we could write for a
  // condition we have not seen before, so it goes through unedited.
  return { title: "The Riot Client refused to launch League", description: fallback };
}

/** Returns a callback that surfaces a launch failure with the right wording. */
export function useLaunchErrorToast() {
  const toast = useToast();

  return useCallback(
    (error: AppError) => {
      const { title, description } = launchErrorMessage(error);
      toast.error(title, description);
      console.error("Failed to launch League:", error);
    },
    [toast],
  );
}
