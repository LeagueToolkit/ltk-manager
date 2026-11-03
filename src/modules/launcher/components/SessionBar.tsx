import {
  CheckIcon,
  InfoIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { match } from "ts-pattern";

import {
  Badge,
  Button,
  ChromeSlot,
  IconButton,
  ProgressBar,
  Spinner,
  Tooltip,
  useChromeSlotFilled,
} from "@/components";
import { usePlatformSupport } from "@/hooks";
import { m } from "@/i18n";
import type { Incident, VerdictKind } from "@/lib/tauri";
import {
  ConsequenceChip,
  isInformational,
  offersRebuild,
  useDismissIncident,
} from "@/modules/diagnostics";
import { ModHealthStatusItem, useHealthVerdicts, useOverlayProgress } from "@/modules/library";
import {
  patcherFailureTab,
  patcherFailureTitle,
  usePatcherStatus,
  useRebuildOverlayAction,
} from "@/modules/patcher";
import {
  type PatcherFailure,
  useIncidentLineStore,
  usePatcherFailureStore,
  usePatcherSessionStore,
  usePlaySessionStore,
} from "@/stores";

import { useCancelLaunch, useLaunchAvailability, useLaunchProgress } from "../api";
import { deriveSessionView, type SessionView, type StepState } from "../utils/sessionView";
import { SessionProfileLabel } from "./SessionProfileLabel";

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
    return <SpinnerGapIcon className="size-3.5 animate-spin text-accent-500" />;
  }
  if (state === "done") return <CheckIcon className="size-3.5 text-success-text" />;
  if (state === "failed") return <WarningCircleIcon className="size-3.5 text-danger-text" />;
  return <span className={`size-3.5 rounded-full ${dotClasses[state]}`} />;
}

/**
 * A highlight running the length of the working line.
 *
 * The travelling element spans the full width - it is the gradient's stops that
 * keep the lit band narrow, which is what lets the stock `shimmer` keyframe
 * carry it edge to edge whatever the window is doing.
 */
function BorderShimmer() {
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden">
      <span className="absolute inset-0 animate-border-shimmer bg-linear-to-r from-transparent from-47% via-accent-100 via-50% to-transparent to-53%" />
    </span>
  );
}

/**
 * The bar itself: its chrome, the two regions every state fills, and the slot a page
 * draws its own actions in.
 *
 * Per "The status bar item" in docs/ux/MOD_HEALTH.md. The activity region is
 * whichever line has the news, and it supersedes itself as the session moves.
 * The items to its right are ambient and answer to nothing the session does, so
 * they outlive every line that passes underneath them.
 */
function Bar({ working, children }: { working?: boolean; children?: ReactNode }) {
  return (
    <div className="relative flex shrink-0 items-stretch gap-2 bg-surface-950 px-2 py-1 select-none">
      {working && (
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-accent-500" />
      )}
      {working && <BorderShimmer />}
      <div className="min-w-0 flex-1">{children}</div>
      <ModHealthStatusItem />
      <ChromeSlot name="status" />
    </div>
  );
}

function RestingLine({
  part,
  detail,
  children,
}: {
  part?: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Bar>
      <div data-ui={part ? `SessionBar:${part}` : undefined} className="px-3 py-1">
        <div className="flex h-5 items-center gap-2 text-row">{children}</div>
        {detail && (
          <p className="mt-0.5 ml-5.5 truncate text-meta text-surface-500 select-text">{detail}</p>
        )}
      </div>
    </Bar>
  );
}

function Middot() {
  return (
    <span aria-hidden className="text-surface-600">
      ·
    </span>
  );
}

/* Workshop resolves a path the session carries to the name the reader gave the
   project, and is the largest module in the app. Dynamic, so an idle bar draws
   without it. */
const SessionProjectNames = lazy(() =>
  import("@/modules/workshop").then((m) => ({ default: m.SessionProjectNames })),
);

/** What the session is testing, once workshop has answered with the names. */
function TestingPill({ className }: { className?: string }) {
  return (
    <Suspense fallback={null}>
      <SessionProjectNames>
        {(names) => {
          const label = describeTestingProjects(names);
          if (!label) return null;
          return (
            <Badge size="md" tone="accent" className={className}>
              {label}
              <SessionProfileLabel />
            </Badge>
          );
        }}
      </SessionProjectNames>
    </Suspense>
  );
}

function VerdictGlyph({ kind }: { kind: VerdictKind }) {
  /* DS-TEXT. */
  if (isInformational(kind)) {
    return <InfoIcon className="size-3.5 shrink-0 text-info-text" weight="fill" />;
  }
  return <WarningIcon className="size-3.5 shrink-0 text-danger-text" weight="fill" />;
}

function LineActions({
  label,
  onAction,
  onDismiss,
  children,
}: {
  label: string;
  onAction: () => void;
  onDismiss: () => void;
  /** An action of the line's own, ahead of the one every line carries. */
  children?: ReactNode;
}) {
  return (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      {children}
      <Button variant="ghost" size="xs" onClick={onAction} className="h-5">
        {label}
      </Button>
      <IconButton
        icon={<XIcon />}
        onClick={onDismiss}
        aria-label={m.launcher_session_dismiss()}
        size="row"
      />
    </div>
  );
}

/**
 * The verdict on the last game that went wrong, in the idle line's place.
 *
 * It holds the bar until the user closes it, a build takes the bar back, or the
 * next game attaches. The incident itself waits on the Games tab. A verdict
 * with the rebuild hint offers the rebuild here too.
 */
function VerdictLine({ incident }: { incident: Incident }) {
  const navigate = useNavigate();
  const dismiss = useDismissIncident();
  const rebuild = useRebuildOverlayAction();
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
      <span className="shrink-0 font-medium text-surface-300">
        {m.launcher_session_league_closed()}
      </span>
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
        label={m.launcher_session_details()}
        onAction={() =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } })
        }
        onDismiss={handleDismiss}
      >
        {offersRebuild(verdict) && (
          <Button
            variant="ghost"
            size="xs"
            onClick={rebuild.run}
            loading={rebuild.pending}
            className="h-5"
          >
            {rebuild.label}
          </Button>
        )}
      </LineActions>
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
      <WarningIcon className="size-3.5 shrink-0 text-danger-text" weight="fill" />
      <span className="font-medium text-danger-text">
        {failure.title ?? patcherFailureTitle(failure.stage)}
      </span>
      <LineActions
        label={m.launcher_session_diagnostics()}
        onAction={() =>
          navigate({ to: "/diagnostics", search: { tab: patcherFailureTab(failure.stage) } })
        }
        onDismiss={clear}
      />
    </RestingLine>
  );
}

function cancelLabel(cancelling: boolean): string {
  if (cancelling) return m.launcher_session_cancelling();
  return m.launcher_session_cancel();
}

/**
 * Ends the wait for the Riot Client.
 *
 * Not the launch: a request the client already accepted starts a game whatever
 * this app does next, which is why the button says it stopped waiting rather
 * than promising nothing will happen. The backend checks the flag between the
 * steps of its wait, so a press can take a poll to land - hence "Cancelling"
 * rather than the bar closing on the click.
 */
function CancelLaunchButton() {
  const step = usePlaySessionStore((s) => s.step);
  const cancelLaunch = useCancelLaunch();

  if (step !== "launching" && step !== "cancelling") return null;

  const cancelling = step === "cancelling";

  return (
    <Tooltip content={m.launcher_session_cancel_hint()}>
      <Button variant="ghost" size="xs" onClick={() => cancelLaunch.mutate()} disabled={cancelling}>
        {cancelLabel(cancelling)}
      </Button>
    </Tooltip>
  );
}

/**
 * The app's status bar: patcher state at rest, the play session when there is one.
 *
 * The session half supersedes the old build-only bar, which unmounted the moment
 * the build finished - exactly when the longest silent wait began. It now runs
 * to the end of the game rather than to the end of the launch request, because
 * the Riot Client's own session record is what says when that is.
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
  const session = usePlaySessionStore((s) => s.session);
  const stopping = usePatcherSessionStore((s) => s.stopping);
  const incident = useIncidentLineStore((s) => s.incident);
  const failure = usePatcherFailureStore((s) => s.failure);
  const clearFailure = usePatcherFailureStore((s) => s.clear);
  const { data: platform } = usePlatformSupport();
  const broken = useHealthVerdicts({ health: "broken" });
  const pageActions = useChromeSlotFilled("status");
  const phase = patcherStatus?.phase ?? "idle";

  // A build that starts is the user trying again, and the start that failed
  // before it is history.
  useEffect(() => {
    if (phase !== "idle") clearFailure();
  }, [phase, clearFailure]);

  const view = deriveSessionView({
    phase,
    playStep,
    overlayProgress,
    launchProgress,
    session,
    stopping,
    incident,
    failure,
    patcherAvailable: platform?.patcherAvailable ?? true,
    hasBroken: broken.length > 0,
    leagueRunning: availability?.leagueRunning ?? false,
  });

  return match(view)
    .with({ kind: "hidden" }, () => {
      if (!pageActions) return null;
      return <Bar />;
    })
    .with({ kind: "itemsOnly" }, () => <Bar />)
    .with({ kind: "stopping" }, () => (
      <RestingLine>
        <Spinner size={14} className="shrink-0" />
        <span className="font-medium text-surface-300">
          {m.launcher_session_stopping_patcher()}
        </span>
        <span className="text-surface-500">
          {m.launcher_session_waiting_for_the_injector_to_shut_down()}
        </span>
      </RestingLine>
    ))
    .with({ kind: "verdict" }, ({ incident }) => <VerdictLine incident={incident} />)
    .with({ kind: "failure" }, ({ failure }) => <FailureLine failure={failure} />)
    .with({ kind: "idle" }, ({ hint }) => (
      <RestingLine>
        <span className="inline-flex size-2 shrink-0 rounded-full border border-surface-600" />
        <span className="font-medium text-surface-300">{m.launcher_session_patcher_idle()}</span>
        <span className="text-surface-500">{hint}</span>
      </RestingLine>
    ))
    .with({ kind: "inGame" }, ({ hint, version }) => (
      <RestingLine>
        <span className="inline-flex size-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
        <span className="font-medium text-success-text">{m.launcher_session_in_game()}</span>
        <span className="text-surface-400">{hint}</span>
        <span className="ml-auto flex items-center gap-2">
          <TestingPill />
          {version && (
            <Tooltip content={m.launcher_session_content_release_hint()}>
              <span className="font-mono text-xs text-surface-500 select-text">{version}</span>
            </Tooltip>
          )}
        </span>
      </RestingLine>
    ))
    .with({ kind: "running" }, () => (
      <RestingLine>
        <span className="inline-flex size-2 shrink-0 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
        <span className="font-medium text-success-text">
          {m.launcher_session_patcher_running()}
        </span>
        <span className="text-surface-400">
          {m.launcher_session_your_mods_will_be_applied_when_league_starts()}
        </span>
        <TestingPill className="ml-auto" />
      </RestingLine>
    ))
    .with({ kind: "progress" }, (work) => <ProgressLine work={work} />)
    .exhaustive();
}

/** The stepper, the running work's label and bar, and the launch's cancel. */
function ProgressLine({ work }: { work: Extract<SessionView, { kind: "progress" }> }) {
  const { steps, working, label, value, counter, detail } = work;

  return (
    <Bar working={working}>
      <div className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {steps.map((step) => (
            <div key={step.key} className="flex items-center gap-1.5">
              <StepDot state={step.state} />
              <span className={`text-xs font-medium ${labelClasses[step.state]}`}>
                {step.label}
              </span>
            </div>
          ))}
          <TestingPill />
        </div>

        <div className="mt-1 flex items-center gap-3">
          <span className="text-row text-surface-300">{label}</span>
          <div className="flex-1" />
          {counter && (
            <span className="shrink-0 text-row text-surface-400 tabular-nums">{counter}</span>
          )}
          <CancelLaunchButton />
        </div>

        <div className="mt-1">
          <ProgressBar value={value} className="flex-1" size="sm" />
        </div>

        {detail && <p className="mt-1 truncate text-meta text-surface-500">{detail}</p>}
      </div>
    </Bar>
  );
}

function describeTestingProjects(names: string[]): string | null {
  if (names.length === 1) return m.launcher_session_testing_project({ name: names[0] });
  if (names.length > 1) return m.launcher_session_testing_projects({ count: names.length });
  return null;
}
