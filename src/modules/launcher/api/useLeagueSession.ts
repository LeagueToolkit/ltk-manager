import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useToast } from "@/components";
import type { SessionChanged, SessionEnded, SessionGameRunning, SessionStarted } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { usePatcherStatus, useStopPatcher } from "@/modules/patcher";
import { useSettings } from "@/modules/settings";
import { usePlaySessionStore } from "@/stores";

import { launcherKeys } from "./keys";
import { launcherQueries } from "./queries";

/** The Riot Client's word for a game that closed the way it meant to. */
const CLEAN_EXIT = "Exit";

/**
 * Whether an ending is worth telling the user about.
 *
 * A game that dies during startup used to be silence, and this is the one
 * diagnostic that answers it. Two endings are deliberately quiet: a clean exit,
 * which is every ordinary game, and an ending with no reason at all - the Riot
 * Client went away and took the record with it, so there is nothing to report
 * and inventing a crash would be worse than saying nothing.
 */
function worthReporting({ exitCode, exitReason }: SessionEnded): boolean {
  if (exitReason === null) return false;
  if (exitReason !== CLEAN_EXIT) return true;
  return exitCode !== null && Number(exitCode) !== 0;
}

function endingDetail({ exitCode, exitReason }: SessionEnded): string {
  if (exitCode === null) return `The Riot Client reported "${exitReason}".`;
  return `The Riot Client reported "${exitReason}", exit code ${exitCode}.`;
}

/**
 * Follow the League session the backend is watching.
 *
 * The Riot Client's own record is what answers "did the game actually start,
 * and why did it stop" - questions the manager previously could not answer at
 * all, because a launch ended the moment the request was delivered.
 *
 * Mount once for the app's lifetime rather than beside the status bar: a
 * session can outlive any page, and one begun before this app started is
 * reported the same way.
 */
export function useLeagueSession() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessionStarted = usePlaySessionStore((s) => s.sessionStarted);
  const sessionChanged = usePlaySessionStore((s) => s.sessionChanged);
  const sessionGameRunning = usePlaySessionStore((s) => s.sessionGameRunning);
  const sessionEnded = usePlaySessionStore((s) => s.sessionEnded);

  const { data: settings } = useSettings();
  const { data: patcherStatus } = usePatcherStatus();
  const stopPatcher = useStopPatcher();

  const { data: current } = useQuery(launcherQueries.session());

  useEffect(() => {
    // Only ever seeds an empty bar. An event that has already told the store
    // what the session is doing is the fresher answer of the two.
    if (!current) return;
    if (usePlaySessionStore.getState().session !== null) return;
    sessionStarted(current);
  }, [current, sessionStarted]);

  // Whether League is up is half of what availability answers, and a session
  // beginning or ending is the exact moment it changes.
  const refreshAvailability = () =>
    queryClient.invalidateQueries({ queryKey: launcherKeys.availability() });

  useTauriEvent<SessionStarted>("session-started", (payload) => {
    sessionStarted(payload);
    void refreshAvailability();
  });

  useTauriEvent<SessionChanged>("session-changed", sessionChanged);

  useTauriEvent<SessionGameRunning>("session-game-running", (payload) => {
    sessionGameRunning(payload);
    void refreshAvailability();
  });

  useTauriEvent<SessionEnded>("session-ended", (payload) => {
    sessionEnded();
    void refreshAvailability();

    if (worthReporting(payload)) {
      toast.warning("League closed unexpectedly", endingDetail(payload));
    }

    // Off by default: a patcher that runs until told to stop is right for
    // someone playing several games, and only wrong for someone playing one.
    if (settings?.stopPatcherOnSessionEnd && patcherStatus?.running) {
      stopPatcher.mutate();
    }
  });
}
