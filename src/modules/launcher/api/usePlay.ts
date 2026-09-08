import { useCallback } from "react";

import { useToast } from "@/components";
import { api, type AppError, isOk, type LaunchOutcome } from "@/lib/tauri";
import { useGuardedStartPatcher } from "@/modules/library";
import { useHddWarning } from "@/modules/settings";
import { type PlayStep, usePlaySessionStore } from "@/stores";

import { useLaunchErrorToast } from "./useLaunchErrorToast";
import { useLaunchLeague } from "./useLaunchLeague";

/**
 * Steps where an action of ours is in flight.
 *
 * Not the same as "the run is over": a live session keeps the step off idle for
 * the length of a game, and the Play button has to stay usable through that -
 * the patcher is still stoppable, and a second launch would only find the game
 * that is already up.
 */
const BUSY_STEPS = new Set<PlayStep>(["starting-patcher", "launching", "cancelling"]);

/** How long `start_patcher` gets to move the phase off idle at all. */
const STARTUP_TIMEOUT_MS = 10_000;
/** How long the overlay build itself may take - a first build on an HDD is minutes. */
const BUILD_TIMEOUT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 500;

export type { PlayStep };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the patcher is up and waiting for the game.
 *
 * `start_patcher` returns as soon as its background thread is spawned, so
 * watching the phase is the only way to know the overlay finished building.
 * Two budgets rather than one: a short one for the thread to pick the work up
 * at all, then a long one once it has. A start that was refused never leaves
 * idle, and making that case wait out the full build timeout would read as a
 * hang.
 */
async function waitForPatcher(): Promise<boolean> {
  const startupDeadline = Date.now() + STARTUP_TIMEOUT_MS;
  let buildDeadline: number | null = null;

  for (;;) {
    const result = await api.getPatcherStatus();
    if (isOk(result)) {
      const { phase } = result.value;
      if (phase === "patching") return true;
      if (phase === "building" && buildDeadline === null) {
        buildDeadline = Date.now() + BUILD_TIMEOUT_MS;
      }
      // Idle after the build had started means it failed or was stopped;
      // `usePatcherError` has already surfaced the reason.
      if (phase === "idle" && buildDeadline !== null) return false;
    }

    if (Date.now() > (buildDeadline ?? startupDeadline)) return false;
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * The composed "Play" action: build the overlay, wait for the patcher to come
 * up, then ask the Riot Client to launch League.
 *
 * Sequenced here rather than in one backend command on purpose. The two halves
 * fail independently and are independently useful - launching without mods,
 * patching for a client the user started themselves - so they stay two
 * commands and this hook owns the ordering.
 *
 * That second case is also why a running League client is not an error: mods
 * are injected into the game process, which the client starts later, so the
 * patcher half still does its job when the launch half has nothing left to do.
 *
 * A run does not end where the launch does. `launch_league` returns when the
 * Riot Client accepts the request, seconds to minutes before the game exists,
 * so the session the outcome names carries it from there - and the store's
 * session events, not this hook, are what return the step to idle.
 */
export function usePlay() {
  const maybeShowHddWarning = useHddWarning();
  const { start } = useGuardedStartPatcher();
  const launchLeague = useLaunchLeague();
  const showLaunchError = useLaunchErrorToast();
  const toast = useToast();

  const step = usePlaySessionStore((s) => s.step);
  const setStep = usePlaySessionStore((s) => s.setStep);
  const launchDelivered = usePlaySessionStore((s) => s.launchDelivered);

  const launch = useCallback(async (): Promise<LaunchOutcome | null> => {
    try {
      return await launchLeague.mutateAsync(undefined);
    } catch (error) {
      showLaunchError(error as AppError);
      return null;
    }
  }, [launchLeague, showLaunchError]);

  // Read through the store rather than the subscribed value: two clicks in the
  // same tick would both see a stale `step` from the render they closed over.
  const isFree = () => !BUSY_STEPS.has(usePlaySessionStore.getState().step);

  /**
   * Hand the run over to the session, or end it here when there is none.
   *
   * A null outcome is a refused launch, a cancelled one, or a request the
   * backend was already handling. None of those has a session to wait on.
   */
  const handOver = useCallback(
    (outcome: LaunchOutcome | null) => {
      if (!outcome) {
        setStep("idle");
        return;
      }
      launchDelivered(Boolean(outcome.sessionId));
    },
    [launchDelivered, setStep],
  );

  const play = useCallback(async () => {
    if (!isFree()) return;
    setStep("starting-patcher");

    try {
      await maybeShowHddWarning();
      await start({});
      if (!(await waitForPatcher())) {
        setStep("idle");
        return;
      }

      setStep("launching");
      handOver(await launch());
    } catch {
      setStep("idle");
    }
  }, [maybeShowHddWarning, start, launch, handOver, setStep]);

  const launchOnly = useCallback(async () => {
    if (!isFree()) return;
    setStep("launching");

    try {
      const outcome = await launch();
      handOver(outcome);

      if (outcome && alreadyUp(outcome)) {
        toast.info("League is already running", alreadyUpDetail(outcome.route));
      }
    } catch {
      setStep("idle");
    }
  }, [launch, handOver, setStep, toast]);

  return { play, launchOnly, step, isBusy: BUSY_STEPS.has(step) };
}

/**
 * Whether the launch found a game rather than starting one.
 *
 * `ADOPTED` is the same news with a better ending: the Riot Client had lost
 * track of the game and has now been handed it, so there is a session to follow
 * where before there was nothing.
 */
function alreadyUp(outcome: LaunchOutcome): boolean {
  return outcome.route === "ALREADY_RUNNING" || outcome.route === "ADOPTED";
}

/** Whether anything came of finding the game, beyond leaving it alone. */
function alreadyUpDetail(route: LaunchOutcome["route"]): string {
  if (route === "ADOPTED") {
    return "There was nothing to launch. The manager is following the game you already had open.";
  }
  return "There was nothing to launch, so your open client was left alone.";
}
