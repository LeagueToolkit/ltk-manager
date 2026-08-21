import {
  CheckIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { Button, IconButton, Progress } from "@/components";
import { usePlatformSupport } from "@/hooks";
import type { Incident, LaunchProgress, OverlayProgress, VerdictKind } from "@/lib/tauri";
import { ConsequenceChip, isInformational, useDismissIncident } from "@/modules/diagnostics";
import {
  patcherFailureTab,
  patcherFailureTitle,
  useOverlayProgress,
  usePatcherStatus,
} from "@/modules/patcher";
import { useSessionProjectNames } from "@/modules/workshop";
import {
  type PatcherFailure,
  useIncidentLineStore,
  usePatcherFailureStore,
  usePatcherSessionStore,
  usePlaySessionStore,
} from "@/stores";

import { useLaunchAvailability, useLaunchProgress } from "../api";

type StepState = "pending" | "active" | "done" | "failed";

interface Step {
  key: string;
  label: string;
  state: StepState;
}

const overlayStageLabels: Record<OverlayProgress["stage"], string> = {
  indexing: "Indexing game files...",
  collecting: "Collecting mod overrides...",
  patching: "Patching WAD files...",
  strings: "Applying string overrides...",
  complete: "Overlay built successfully!",
};

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
  error: "Could not start League.",
};

function isDeterminate(stage: OverlayProgress["stage"]) {
  return stage === "patching" || stage === "strings";
}

const dotClasses: Record<StepState, string> = {
  pending: "border border-surface-600 bg-transparent",
  active: "border border-accent-500 bg-accent-500/30",
  done: "border border-success/60 bg-success/20",
  failed: "border border-danger/60 bg-danger/20",
};

const labelClasses: Record<StepState, string> = {
  pending: "text-surface-500",
  active: "text-accent-400",
  done: "text-surface-300",
  failed: "text-danger-text",
};

function StepDot({ state }: { state: StepState }) {
  if (state === "active") {
    return <SpinnerGapIcon className="h-3.5 w-3.5 animate-spin text-accent-500" />;
  }
  if (state === "done") return <CheckIcon className="h-3.5 w-3.5 text-success-text" />;
  if (state === "failed") return <WarningCircleIcon className="h-3.5 w-3.5 text-danger-text" />;
  return <span className={`h-3.5 w-3.5 rounded-full ${dotClasses[state]}`} />;
}

/**
 * A highlight running the length of the bar's top border.
 *
 * `-top-0.5` backs it out of the padding box onto the 2px border itself, so the
 * shimmer travels along the accent line rather than inside the bar.
 *
 * The travelling element spans the full width - it is the gradient's stops that
 * keep the lit band narrow, which is what lets the stock `shimmer` keyframe
 * carry it edge to edge whatever the window is doing.
 */
function BorderShimmer() {
  return (
    <span className="pointer-events-none absolute inset-x-0 -top-0.5 h-0.5 overflow-hidden">
      <span className="absolute inset-0 animate-border-shimmer bg-gradient-to-r from-transparent from-47% via-accent-100 via-50% to-transparent to-53%" />
    </span>
  );
}

function RestingLine({
  part,
  detail,
  children,
}: {
  part?: string;
  /** A second line under the first. Always the backend's words, so it stays selectable. */
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-ui={part ? `SessionBar:${part}` : undefined}
      className="shrink-0 border-t border-surface-800 bg-surface-950 px-4 py-1.5 select-none"
    >
      <div className="flex items-center gap-2 text-sm">{children}</div>
      {detail && (
        <p className="mt-0.5 ml-5.5 truncate text-xs text-surface-500 select-text">{detail}</p>
      )}
    </div>
  );
}

function Middot() {
  return (
    <span aria-hidden className="text-surface-600">
      ·
    </span>
  );
}

function VerdictGlyph({ kind }: { kind: VerdictKind }) {
  /* DS-TEXT. */
  if (isInformational(kind)) {
    return <InfoIcon className="h-3.5 w-3.5 shrink-0 text-info-text" weight="fill" />;
  }
  return <WarningIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" weight="fill" />;
}

function LineActions({
  label,
  onAction,
  onDismiss,
}: {
  label: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button variant="ghost" size="xs" compact onClick={onAction}>
        {label}
      </Button>
      <IconButton
        icon={<XIcon className="h-3.5 w-3.5" weight="bold" />}
        variant="ghost"
        size="xs"
        compact
        onClick={onDismiss}
        aria-label="Dismiss"
      />
    </div>
  );
}

/**
 * The verdict on the last game that went wrong, in the idle line's place.
 *
 * It holds the bar until the user closes it, a build takes the bar back, or the
 * next game attaches. The incident itself waits on the Games tab.
 */
function VerdictLine({ incident }: { incident: Incident }) {
  const navigate = useNavigate();
  const dismiss = useDismissIncident();
  const clearFailure = usePatcherFailureStore((s) => s.clear);
  const { verdict, suspects } = incident;
  const [suspect] = suspects;

  function handleDismiss() {
    dismiss.mutate(incident.id);
    // The failed start this incident classified would otherwise surface from under it.
    clearFailure();
  }

  return (
    <RestingLine part="verdict">
      <VerdictGlyph kind={verdict.kind} />
      <span className="shrink-0 font-medium text-surface-300">League closed</span>
      <Middot />
      <span className="shrink-0 text-surface-200">{verdict.title}</span>
      {verdict.subject && (
        <>
          <Middot />
          <span className="truncate font-mono text-xs text-surface-300 select-text">
            {verdict.subject}
          </span>
        </>
      )}
      {suspect && (
        <>
          <Middot />
          <span className="truncate text-surface-300 select-text">{suspect.displayName}</span>
          {suspects.length > 1 && (
            <span className="shrink-0 text-xs text-surface-500">+{suspects.length - 1}</span>
          )}
        </>
      )}
      <ConsequenceChip consequence={verdict.consequence} />
      <LineActions
        label="Details"
        onAction={() =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } })
        }
        onDismiss={handleDismiss}
      />
    </RestingLine>
  );
}

/**
 * A start that failed, in the idle line's place rather than a toast that only
 * the Library page would have shown. The action goes where the stage's remedy
 * is, and the next build clears it.
 */
function FailureLine({ failure }: { failure: PatcherFailure }) {
  const navigate = useNavigate();
  const clear = usePatcherFailureStore((s) => s.clear);

  return (
    <RestingLine part="failure" detail={failure.message}>
      <WarningIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" weight="fill" />
      <span className="font-medium text-danger-text">{patcherFailureTitle(failure.stage)}</span>
      <LineActions
        label="Diagnostics"
        onAction={() =>
          navigate({ to: "/diagnostics", search: { tab: patcherFailureTab(failure.stage) } })
        }
        onDismiss={clear}
      />
    </RestingLine>
  );
}

/**
 * The app's status bar: patcher state at rest, the play session when there is one.
 *
 * The session half supersedes the old build-only bar, which unmounted the moment
 * the build finished - exactly when the longest silent wait began.
 *
 * Anchored at the bottom of the window, below the page rather than above it. A
 * bar that appears above a scroll container pushes every visible row down as it
 * mounts. Below one, the container's top edge holds still and only its height
 * changes, so nothing the user is looking at moves. It never unmounts now, so
 * the page above it does not resize at all.
 */
export function SessionBar() {
  const { data: patcherStatus } = usePatcherStatus();
  const overlayProgress = useOverlayProgress();
  const launchProgress = useLaunchProgress();
  const { data: availability } = useLaunchAvailability();
  const playStep = usePlaySessionStore((s) => s.step);
  const sessionProjects = useSessionProjectNames();
  const stopping = usePatcherSessionStore((s) => s.stopping);
  const incident = useIncidentLineStore((s) => s.incident);
  const failure = usePatcherFailureStore((s) => s.failure);
  const clearFailure = usePatcherFailureStore((s) => s.clear);
  const { data: platform } = usePlatformSupport();

  const patcherAvailable = platform?.patcherAvailable ?? true;
  const phase = patcherStatus?.phase ?? "idle";
  const isBuilding = phase === "building";
  const patcherUp = phase === "patching";

  // A build that starts is the user trying again, and the start that failed
  // before it is history.
  useEffect(() => {
    if (phase !== "idle") clearFailure();
  }, [phase, clearFailure]);

  // The launch half is only part of this session when it was asked for. A bare
  // Ctrl+P start must not grow a step the user never requested.
  const launching = playStep === "launching" || launchProgress !== null;
  const showsLaunch = playStep !== "idle" || launchProgress !== null;

  // The stop is signalled instantly but unwinds over seconds, and "Patcher
  // running / your mods will be applied" is the wrong thing to say for those
  // seconds - the user has just told it to stop.
  if (stopping) {
    return (
      <RestingLine>
        <SpinnerGapIcon className="h-3.5 w-3.5 shrink-0 animate-spin text-surface-400" />
        <span className="font-medium text-surface-300">Stopping patcher</span>
        <span className="text-surface-500">Waiting for the injector to shut down...</span>
      </RestingLine>
    );
  }

  if (phase === "idle" && !showsLaunch) {
    // Where the patcher cannot run, "idle" is a permanent fact rather than a
    // state the user can act on, and `PatcherUnsupported` already explains why.
    if (!patcherAvailable) return null;

    // The incident is the classified record of a failure, so it outranks the
    // raw start failure that preceded it.
    if (incident) return <VerdictLine incident={incident} />;
    if (failure) return <FailureLine failure={failure} />;

    return (
      <RestingLine>
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full border border-surface-600" />
        <span className="font-medium text-surface-300">Patcher idle</span>
        <span className="text-surface-500">{idleHint(availability?.leagueRunning ?? false)}</span>
      </RestingLine>
    );
  }

  // Once everything has settled there is nothing left to step through, and a
  // stepper frozen at "all done" for a whole game is just noise.
  const settled = patcherUp && !launching;
  if (settled) {
    return (
      <RestingLine>
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
        <span className="font-medium text-success-text">Patcher running</span>
        <span className="text-surface-400">Your mods will be applied when League starts.</span>
        {sessionProjects.length > 0 && (
          <span className="ml-auto rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-400">
            {describeTestingProjects(sessionProjects)}
          </span>
        )}
      </RestingLine>
    );
  }

  function patcherStepState(): StepState {
    if (isBuilding) return "pending";
    if (patcherUp) return "done";
    return "active";
  }

  function launchStepState(): StepState {
    if (launchProgress?.stage === "error") return "failed";
    if (launchProgress?.stage === "launched" || launchProgress?.stage === "alreadyRunning") {
      return "done";
    }
    if (launching) return "active";
    return "pending";
  }

  const steps: Step[] = [];

  // "Launch League only" runs no patcher at all, so an idle phase means the
  // build and patcher steps are not part of this session rather than pending.
  if (phase !== "idle" || playStep === "starting-patcher") {
    steps.push(
      { key: "build", label: "Build overlay", state: isBuilding ? "active" : "done" },
      { key: "patcher", label: "Start patcher", state: patcherStepState() },
    );
  }

  if (showsLaunch) {
    steps.push({ key: "launch", label: "Launch League", state: launchStepState() });
  }

  const { label, value, counter, detail } = describeCurrentWork(
    isBuilding,
    overlayProgress,
    launching,
    launchProgress,
  );

  const testLabel = describeTestingProjects(sessionProjects);

  // Tied to the steps rather than to `launching`, so the shimmer dies the moment
  // the last one settles instead of running on a bar with nothing left to do.
  const working = steps.some((step) => step.state === "active");

  return (
    <div className="relative shrink-0 border-t-2 border-accent-500 bg-surface-950 px-4 py-2 select-none">
      {working && <BorderShimmer />}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {steps.map((step) => (
          <div key={step.key} className="flex items-center gap-1.5">
            <StepDot state={step.state} />
            <span className={`text-xs font-medium ${labelClasses[step.state]}`}>{step.label}</span>
          </div>
        ))}
        {testLabel && (
          <span className="rounded-full bg-accent-500/10 px-2 py-0.5 text-xs font-medium text-accent-400">
            {testLabel}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <span className="text-sm text-surface-300">{label}</span>
        <div className="flex-1" />
        {counter && (
          <span className="shrink-0 text-sm text-surface-400 tabular-nums">{counter}</span>
        )}
      </div>

      <div className="mt-1.5">
        <Progress.Root value={value} className="flex-1">
          <Progress.Track size="sm">
            <Progress.Indicator />
          </Progress.Track>
        </Progress.Root>
      </div>

      {detail && <p className="mt-1 truncate text-xs text-surface-500">{detail}</p>}
    </div>
  );
}

/**
 * The idle line's second half.
 *
 * With the client already up, "start the patcher" invites the reasonable worry
 * that it is too late - so that case says which game the mods land in.
 */
function idleHint(leagueRunning: boolean): string {
  if (leagueRunning) return "League is running - start the patcher to mod your next game.";
  return "Start the patcher to apply your mods.";
}

function describeTestingProjects(names: string[]): string | null {
  if (names.length === 1) return `Testing ${names[0]}`;
  if (names.length > 1) return `Testing ${names.length} projects`;
  return null;
}

/**
 * Collapse whichever half is running into one label, bar and detail line.
 *
 * The launch takes precedence: when both have something to say the launch is
 * the newer news, and the build's last message is already history.
 */
function describeCurrentWork(
  isBuilding: boolean,
  overlay: OverlayProgress | null,
  launching: boolean,
  launch: LaunchProgress | null,
) {
  if (launching && launch) {
    // Only the wait for a booting client knows how long it has left. Every
    // other stage is genuinely open-ended, so it gets an indeterminate bar.
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
      detail: overlay?.currentFile ?? null,
    };
  }

  return { label: "Starting the patcher...", value: null, counter: null, detail: null };
}
