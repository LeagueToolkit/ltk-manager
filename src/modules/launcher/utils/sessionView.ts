import type {
  Incident,
  LaunchProgress,
  OverlayProgress,
  PatcherPhase,
  PrepareStep,
} from "@/lib/tauri";
import type { LeagueSession, PatcherFailure, PlayStep } from "@/stores";

export type StepState = "pending" | "active" | "done" | "failed";

export interface Step {
  key: string;
  label: string;
  state: StepState;
}

/** What the session bar knows about the patcher, the launch and the game. */
export interface SessionInputs {
  readonly phase: PatcherPhase;
  readonly playStep: PlayStep;
  readonly overlayProgress: OverlayProgress | null;
  readonly launchProgress: LaunchProgress | null;
  readonly session: LeagueSession | null;
  readonly stopping: boolean;
  readonly incident: Incident | null;
  readonly failure: PatcherFailure | null;
  readonly patcherAvailable: boolean;
  /** A mod in the library is broken, which the bar draws an item for. */
  readonly hasBroken: boolean;
  readonly leagueRunning: boolean;
}

/** The label, bar value, counter and detail line of whatever is running. */
export interface Work {
  readonly label: string;
  readonly value: number | null;
  readonly counter: string | null;
  readonly detail: string | null;
}

/** The one line the session bar draws, and what it says. */
export type SessionView =
  | { readonly kind: "hidden" }
  | { readonly kind: "itemsOnly" }
  | { readonly kind: "stopping" }
  | { readonly kind: "verdict"; readonly incident: Incident }
  | { readonly kind: "failure"; readonly failure: PatcherFailure }
  | { readonly kind: "idle"; readonly hint: string }
  | { readonly kind: "inGame"; readonly hint: string; readonly version: string | null }
  | { readonly kind: "running" }
  | ({ readonly kind: "progress"; readonly steps: Step[]; readonly working: boolean } & Work);

const overlayStageLabels: Record<OverlayProgress["stage"], string> = {
  preparing: "Preparing build...",
  indexing: "Indexing game files...",
  collecting: "Collecting mod overrides...",
  patching: "Patching WAD files...",
  strings: "Applying string overrides...",
  complete: "Overlay built successfully!",
};

/** What the build is doing before the builder runs, drawn under "Preparing build...". */
export function prepareStepLabel(step: PrepareStep): string {
  switch (step.kind) {
    case "patcher":
      return "Downloading the patcher...";
    case "gameExit":
      return "Waiting for the game to close...";
    case "library":
      return "Reading the library...";
    case "builtinMod":
      return `Generating ${step.name}...`;
    case "game":
      return "Reading the game...";
  }
}

/** The detail line of an overlay stage: the preparing step, or the file being patched. */
function overlayDetail(overlay: OverlayProgress | null): string | null {
  if (!overlay) return null;
  if (overlay.step) return prepareStepLabel(overlay.step);
  return overlay.currentFile;
}

/**
 * What each launch stage is actually waiting on.
 *
 * These are the lines that remove support load. "Launching..." with no reason
 * reads as a hang when the Riot Client takes five seconds just to draw itself.
 */
const launchStageLabels: Record<LaunchProgress["stage"], string> = {
  resolving: "Looking for the Riot Client...",
  handingOff: "Asking the Riot Client to start League...",
  coldStart: "Starting the Riot Client. This can take a few seconds to appear.",
  wakingClient: "Waking the Riot Client from the tray...",
  waitingForClient: "Waiting for the Riot Client to finish starting up...",
  launched: "League is starting.",
  alreadyRunning: "League is already running - nothing to launch.",
  // Not worded as a failure: the wait is what was cancelled, and a request the
  // Riot Client had already taken still starts a game.
  stopped: "Cancelled. The manager stopped waiting for the Riot Client.",
  error: "Could not start League.",
  unknown: "Working...",
};

/** Which line the session bar draws for `inputs`. */
export function deriveSessionView(inputs: SessionInputs): SessionView {
  const { phase, playStep, launchProgress, session } = inputs;
  const isBuilding = phase === "building";
  const patcherUp = phase === "patching";

  // The launch half is only part of this session when it was asked for. A bare
  // Ctrl+P start must not grow a step the user never requested.
  const launching =
    playStep === "launching" || playStep === "cancelling" || launchProgress !== null;
  const waitingForGame = playStep === "waiting-for-game";
  const showsLaunch = playStep !== "idle" || launchProgress !== null;

  // Whether anything is still stepping. A game running is not: it is where the
  // stepper ends, and the resting lines below are only right once nothing else
  // has progress left to report.
  const hasProgress = isBuilding || launching || waitingForGame || playStep === "starting-patcher";

  // The stop is signalled instantly but unwinds over seconds, and "Patcher
  // running" is the wrong thing to say for those seconds.
  if (inputs.stopping) return { kind: "stopping" };

  if (phase === "idle" && !showsLaunch && session === null) {
    // Where the patcher cannot run, "idle" is a permanent fact rather than a
    // state the user can act on, and `PatcherUnsupported` already explains why.
    if (!inputs.patcherAvailable) return { kind: inputs.hasBroken ? "itemsOnly" : "hidden" };

    // The incident is the classified record of a failure, so it outranks the
    // raw start failure that preceded it.
    if (inputs.incident) return { kind: "verdict", incident: inputs.incident };
    if (inputs.failure) return { kind: "failure", failure: inputs.failure };

    return { kind: "idle", hint: idleHint(inputs.leagueRunning) };
  }

  // The game is up, and the session is what says when that ends. A build
  // started mid-game still outranks it, since that one has progress to show.
  if (session?.running && !hasProgress) {
    return { kind: "inGame", hint: inGameHint(patcherUp), version: session.version ?? null };
  }

  // Once everything has settled, a stepper frozen at "all done" is just noise.
  if (patcherUp && !launching && !waitingForGame) return { kind: "running" };

  const steps: Step[] = [];

  // "Launch League only" runs no patcher at all, so an idle phase means the
  // build and patcher steps are not part of this session rather than pending.
  if (phase !== "idle" || playStep === "starting-patcher") {
    steps.push(
      { key: "build", label: "Build overlay", state: isBuilding ? "active" : "done" },
      { key: "patcher", label: "Start patcher", state: patcherStepState(isBuilding, patcherUp) },
    );
  }

  if (showsLaunch) {
    steps.push(
      {
        key: "launch",
        label: "Launch League",
        state: launchStepState(launchProgress, launching, waitingForGame, session),
      },
      { key: "game", label: "In game", state: waitingForGame ? "active" : "pending" },
    );
  }

  const work = describeCurrentWork(
    isBuilding,
    inputs.overlayProgress,
    launching,
    launchProgress,
    waitingForGame,
    session,
  );

  // Tied to the steps rather than to `launching`, so the shimmer dies the moment
  // the last one settles.
  const working = steps.some((step) => step.state === "active");
  return { kind: "progress", steps, working, ...work };
}

function patcherStepState(isBuilding: boolean, patcherUp: boolean): StepState {
  if (isBuilding) return "pending";
  if (patcherUp) return "done";
  return "active";
}

function launchStepState(
  launch: LaunchProgress | null,
  launching: boolean,
  waitingForGame: boolean,
  session: LeagueSession | null,
): StepState {
  if (launch?.stage === "error") return "failed";
  // A cancel is neither: nothing failed and nothing happened, so the step
  // stays as it was before the launch was asked for.
  if (launch?.stage === "stopped") return "pending";
  if (waitingForGame || session !== null) return "done";
  if (launch?.stage === "launched" || launch?.stage === "alreadyRunning") return "done";
  if (launching) return "active";
  return "pending";
}

/**
 * The idle line's second half.
 *
 * With the client already up, "start the patcher" invites the reasonable worry
 * that it is too late, so that case says which game the mods land in.
 */
function idleHint(leagueRunning: boolean): string {
  if (leagueRunning) return "League is running - start the patcher to mod your next game.";
  return "Start the patcher to apply your mods.";
}

/**
 * The in-game line's second half.
 *
 * A session the manager is following is not the same as a modded one, so the
 * line says which of the two this is.
 */
function inGameHint(patcherUp: boolean): string {
  if (patcherUp) return "Your mods are being applied.";
  return "The patcher is not running, so this game is unmodded.";
}

/**
 * The client's own word for where the session has got to, when it has one.
 *
 * `None` is the client saying it has nothing to report, so that one gets no line.
 */
function sessionDetail(session: LeagueSession | null): string | null {
  if (!session || session.phase === "None" || session.phase === "") return null;
  return `Riot Client session: ${session.phase}`;
}

function isDeterminate(stage: OverlayProgress["stage"]) {
  return stage === "patching" || stage === "strings";
}

/**
 * Collapse whichever half is running into one label, bar and detail line.
 *
 * The order is newest news first: the wait for the game supersedes the launch
 * that produced it, and the launch supersedes a build whose last message is
 * already history.
 */
function describeCurrentWork(
  isBuilding: boolean,
  overlay: OverlayProgress | null,
  launching: boolean,
  launch: LaunchProgress | null,
  waitingForGame: boolean,
  session: LeagueSession | null,
): Work {
  if (waitingForGame) {
    return {
      label: "Waiting for League to start...",
      value: null,
      counter: null,
      detail: sessionDetail(session),
    };
  }

  if (launching && launch) {
    // Only the wait for a booting client knows how long it has left. Every
    // other stage is open-ended, so it gets an indeterminate bar.
    const waiting = launch.stage === "waitingForClient" && launch.timeoutSecs > 0;
    return {
      label: launchStageLabels[launch.stage],
      value: waiting ? (launch.waitedSecs / launch.timeoutSecs) * 100 : null,
      counter: waiting ? `${launch.waitedSecs}s` : null,
      detail: null,
    };
  }

  if (launching) {
    return { label: "Starting League...", value: null, counter: null, detail: null };
  }

  if (isBuilding) {
    const stage = overlay?.stage;
    const determinate = stage ? isDeterminate(stage) : false;
    const hasCounts = determinate && overlay !== null && overlay.total > 0;

    return {
      label: (stage && overlayStageLabels[stage]) ?? "Preparing build...",
      value: hasCounts ? (overlay.current / overlay.total) * 100 : null,
      counter: hasCounts ? `${overlay.current} / ${overlay.total}` : null,
      detail: overlayDetail(overlay),
    };
  }

  return { label: "Starting the patcher...", value: null, counter: null, detail: null };
}
