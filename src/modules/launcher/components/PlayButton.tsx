import {
  ArrowsClockwiseIcon,
  CaretDownIcon,
  HourglassIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";

import {
  Button,
  ButtonGroup,
  IconButton,
  Kbd,
  LeagueIcon,
  Menu,
  PatcherIcon,
  Tooltip,
} from "@/components";
import { usePlatformSupport } from "@/hooks";
import { m } from "@/i18n";
import { shortcutOf } from "@/modules/keys";
import { useGuardedStartPatcher } from "@/modules/library";
import { type GuardedLaunch, ModHealthLaunchGuard } from "@/modules/library";
import { useInstalledMods } from "@/modules/library/api";
import { usePatcherStatus, useStopPatcher } from "@/modules/patcher";
import { useHddWarning } from "@/modules/settings";
import { hasBuiltinMods, useSettings } from "@/modules/settings";
import { usePatcherSessionStore, usePendingRebuildStore, usePlaySessionStore } from "@/stores";
import { twMerge } from "@/utils";

import { useLaunchAvailability } from "../api/useLaunchAvailability";
import { usePlay } from "../api/usePlay";
import { useStopLeague } from "../api/useStopLeague";

/* The patcher is live, so the control wears the running hue over the accent it
   wears at rest. Slower than the button's own 150ms: this is a state to notice
   rather than a hover to acknowledge. */
const RUNNING_SKIN =
  "border-success/50 bg-success/15 text-success-text transition-colors duration-500 hover:bg-success/25 active:bg-success/35";

interface PlayButtonProps {
  /** Set while a library action that must not overlap a patch is in progress. */
  disabled?: boolean;
  /** Drawn as a block of its own rather than one control in a toolbar row. */
  block?: boolean;
}

function playLabel(
  step: ReturnType<typeof usePlay>["step"],
  isBuilding: boolean,
  patcherOnly: boolean,
): string {
  if (step === "launching") return m.library_play_launching_label();
  if (step === "cancelling") return m.library_play_cancelling_label();
  if (isBuilding) return m.library_play_building_label();
  if (step === "starting-patcher") return m.library_play_starting_label();
  if (patcherOnly) return m.library_patcher_start_action();
  return m.library_play_action();
}

function primaryTooltip(
  patcherOnly: boolean,
  leagueRunning: boolean,
  hasModsToApply: boolean,
): string {
  if (leagueRunning && !hasModsToApply) return m.library_play_league_running_no_mods_hint();
  if (leagueRunning) return m.library_play_league_running_hint();
  if (patcherOnly && !hasModsToApply) return m.library_patcher_no_mods_hint();
  if (patcherOnly) return m.library_patcher_start_hint();
  if (!hasModsToApply) return m.library_play_no_mods_hint();
  return m.library_play_hint();
}

/**
 * Either mark deliberately overflows `Button`'s icon slot. It is the brand on
 * the app's primary action, not a glyph labelling it, so it is sized past what
 * the surrounding icons sit at.
 */
function PrimaryIcon({ patcherOnly }: { patcherOnly: boolean }) {
  if (patcherOnly) return <PatcherIcon className="size-6 shrink-0" />;
  return <LeagueIcon className="size-6 shrink-0" />;
}

/**
 * The forced rebuild a verdict queued for the next start, beside the control
 * that starts it, with the one way to take it back. Per "The verdict line" in
 * docs/ux/LEAGUE_DIAGNOSTICS.md.
 */
function PendingRebuildPill() {
  const queued = usePendingRebuildStore((s) => s.queued);
  const clear = usePendingRebuildStore((s) => s.clear);

  if (!queued) return null;

  return (
    <Tooltip content={m.patcher_rebuild_pending_hint()}>
      <span
        data-ui="PlayButton:pending-rebuild"
        className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-accent-500/10 pr-1 pl-2.5 text-xs font-medium text-accent-400 select-none"
      >
        <ArrowsClockwiseIcon weight="bold" className="size-3.5" />
        {m.patcher_rebuild_pending_label()}
        <IconButton
          icon={<XIcon />}
          onClick={clear}
          aria-label={m.patcher_rebuild_pending_clear_label()}
          size="row"
        />
      </span>
    </Tooltip>
  );
}

/**
 * Library edits the running game holds back until it ends. Per "An edit while
 * the patcher runs" in docs/ux/LIBRARY.md.
 */
function ChangesAfterGamePill() {
  const { data: status } = usePatcherStatus();

  if (!status?.changesAfterGame) return null;

  return (
    <Tooltip content={m.patcher_changes_after_game_hint()}>
      <span
        data-ui="PlayButton:changes-after-game"
        className="inline-flex h-7 items-center justify-center gap-1 rounded-full bg-accent-500/10 px-2.5 text-xs font-medium text-accent-400 select-none"
      >
        <HourglassIcon weight="bold" className="size-3.5" />
        {m.patcher_changes_after_game_label()}
      </span>
    </Tooltip>
  );
}

/**
 * Ends the game through the Riot Client, which is the only thing that can.
 *
 * In the menu rather than on the button, and only while a session is live: the
 * client refuses to close a product it never started, so an entry offered at any
 * other time would be an entry that cannot work.
 */
function StopLeagueMenuItem() {
  const session = usePlaySessionStore((s) => s.session);
  const stopLeague = useStopLeague();

  if (!session) return null;

  return (
    <Menu.Item
      icon={<XCircleIcon weight="bold" className="size-4" />}
      onClick={() => stopLeague.mutate()}
      disabled={stopLeague.isPending}
    >
      {m.library_league_close_action()}
    </Menu.Item>
  );
}

interface LaunchMenuItemProps {
  label: string;
  leagueRunning: boolean;
  disabled: boolean;
  onClick: () => void;
}

/**
 * A menu entry whose action ends in League starting, with a note for the one
 * disabling condition the user can act on.
 *
 * A launch with League already up is a no-op. The label stays put - it names
 * the action, not the state - and the reason rides alongside it.
 */
function LaunchMenuItem({ label, leagueRunning, disabled, onClick }: LaunchMenuItemProps) {
  const icon = <LeagueIcon className="size-4" />;

  if (leagueRunning) {
    return (
      <Menu.Item icon={icon} disabled>
        {label}
        <span className="ml-2 text-xs text-surface-500">
          {m.library_launch_already_running_label()}
        </span>
      </Menu.Item>
    );
  }

  return (
    <Menu.Item icon={icon} onClick={onClick} disabled={disabled}>
      {label}
    </Menu.Item>
  );
}

/**
 * The library's primary action: build the overlay, start the patcher and ask
 * the Riot Client to start League - the whole path in one click.
 *
 * The split menu keeps each half reachable on its own. Someone who launches
 * League from the Riot Client, or who wants the game without mods, must not
 * have to go through the composed flow to get there.
 *
 * Classic mode drops the split: it is the app as it was before it could launch
 * anything, and a menu whose every entry is the launcher is not that. Settings
 * is where that choice is made and unmade.
 *
 * `block` is Home's shape for it: the head of the rail, a size up and the full
 * width of the column, where the toolbar wants one control in a row of them.
 */
export function PlayButton({ disabled = false, block = false }: PlayButtonProps) {
  const { data: platform } = usePlatformSupport();

  // Both halves are Windows-only, so there is nothing to offer elsewhere.
  // `PatcherUnsupported` already explains why on the page itself.
  if (!(platform?.patcherAvailable ?? true)) return null;

  return (
    <div
      data-ui="PlayButton"
      className={twMerge("flex items-center gap-2", block && "w-full flex-col items-stretch")}
    >
      <ChangesAfterGamePill />
      <PendingRebuildPill />
      <ModHealthLaunchGuard className={block ? "w-full" : undefined}>
        {(ask) => <LaunchControls ask={ask} disabled={disabled} block={block} />}
      </ModHealthLaunchGuard>
    </div>
  );
}

interface LaunchControlsProps {
  /** Every action here that ends in a patch goes through this first. */
  ask: GuardedLaunch;
  disabled: boolean;
  block: boolean;
}

function LaunchControls({ ask, disabled, block }: LaunchControlsProps) {
  const { data: mods = [], isLoading } = useInstalledMods();
  const { data: status } = usePatcherStatus();
  const { data: availability } = useLaunchAvailability();
  const { data: settings } = useSettings();
  const { play, launchOnly, step, isBusy } = usePlay();
  const { start: startPatcher } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const stopping = usePatcherSessionStore((s) => s.stopping);
  const maybeShowHddWarning = useHddWarning();

  /* Home's block sits a step above the size scale, at 40px. */
  const blockSize = block ? "h-10 px-5 text-base" : undefined;
  const blockHeight = block ? "h-10" : undefined;
  const groupClass = block ? "w-full" : undefined;

  const isRunning = status?.running ?? false;
  const isBuilding = status?.phase === "building";
  const hasModsToApply = mods.some((m) => m.enabled) || hasBuiltinMods(settings);
  const canLaunch = availability?.canLaunch ?? false;
  const leagueRunning = availability?.leagueRunning ?? false;

  async function handleStartPatcherOnly() {
    await maybeShowHddWarning();
    await startPatcher({});
  }

  // With nothing enabled there is no overlay worth building, so Play collapses
  // to a plain launch rather than spending a build on an empty mod list.
  const handlePlay = hasModsToApply ? play : launchOnly;

  // Settings still loading reads as classic: it is the default, and it is the
  // safer guess - a button that turns out not to launch beats one that launches
  // when the user never asked it to.
  const classic = settings?.launchMode !== "modern";

  // A running client puts the launcher in the same place classic does, since
  // launching into it is a no-op and the button would be promising something it
  // cannot do. The menu stays, though - the launcher was still asked for.
  const patcherOnly = classic || leagueRunning;

  const primaryAction = patcherOnly ? handleStartPatcherOnly : handlePlay;

  if (isRunning && !isBusy) {
    const stopButton = (
      <Tooltip
        content={
          <>
            {stopping && m.library_patcher_stopping_hint()}
            {!stopping && (
              <>
                {m.library_patcher_stop_hint()} <Kbd shortcut={shortcutOf("library.patcher")} />
              </>
            )}
          </>
        }
      >
        <Button
          variant="tonal"
          size="lg"
          onClick={() => stopPatcher.mutate()}
          loading={stopping}
          disabled={disabled || stopping}
          className={twMerge("grow font-bold tracking-wide uppercase", blockSize, RUNNING_SKIN)}
          left={
            !stopping && (
              <span className="inline-flex size-3 rounded-full bg-success shadow-[0_0_5px_1px] shadow-success/50" />
            )
          }
        >
          {stopping && m.library_patcher_stopping_label()}
          {!stopping && m.library_patcher_stop_action()}
        </Button>
      </Tooltip>
    );

    if (classic) return stopButton;

    return (
      <ButtonGroup className={groupClass}>
        {stopButton}
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                icon={<CaretDownIcon />}
                variant="tonal"
                size="lg"
                aria-label={m.library_launch_options_label()}
                narrow
                className={twMerge(blockHeight, RUNNING_SKIN)}
              />
            }
          />
          <Menu.Content className="w-64">
            {/* Unguarded: this starts the game without the patcher, so
                    it carries no mods for the ask to be about. */}
            <LaunchMenuItem
              label={m.library_launch_league_action()}
              leagueRunning={leagueRunning}
              onClick={launchOnly}
              disabled={!canLaunch || isBusy}
            />
            <StopLeagueMenuItem />
          </Menu.Content>
        </Menu.Root>
      </ButtonGroup>
    );
  }

  const busy = isLoading || disabled || isBusy || isBuilding;

  const primaryButton = (
    <Tooltip
      content={
        <>
          {primaryTooltip(patcherOnly, leagueRunning, hasModsToApply)}{" "}
          {patcherOnly && <Kbd shortcut={shortcutOf("library.patcher")} />}
        </>
      }
    >
      <Button
        variant="tonal"
        size="lg"
        onClick={() => ask(primaryAction)}
        loading={isBusy || isBuilding}
        disabled={busy || (patcherOnly && !hasModsToApply)}
        left={<PrimaryIcon patcherOnly={patcherOnly} />}
        className={twMerge("grow gap-3 font-bold tracking-wide uppercase", blockSize)}
      >
        {playLabel(step, isBuilding, patcherOnly)}
      </Button>
    </Tooltip>
  );

  if (classic) return primaryButton;

  return (
    <ButtonGroup className={groupClass}>
      {primaryButton}
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretDownIcon />}
              variant="tonal"
              size="lg"
              disabled={busy}
              aria-label={m.library_launch_options_label()}
              narrow
              className={blockHeight}
            />
          }
        />
        <Menu.Content className="w-64">
          {patcherOnly && (
            <LaunchMenuItem
              label={m.library_play_action()}
              leagueRunning={leagueRunning}
              onClick={() => ask(handlePlay)}
              disabled={!canLaunch}
            />
          )}
          {!patcherOnly && (
            <Menu.Item
              icon={<PatcherIcon className="size-4" />}
              onClick={() => ask(handleStartPatcherOnly)}
              disabled={!hasModsToApply}
              shortcut={shortcutOf("library.patcher")}
            >
              {m.library_patcher_only_action()}
            </Menu.Item>
          )}
          {/* Unguarded, for the reason the other one is. */}
          <LaunchMenuItem
            label={m.library_launch_league_only_action()}
            leagueRunning={leagueRunning}
            onClick={launchOnly}
            disabled={!canLaunch}
          />
          <StopLeagueMenuItem />
        </Menu.Content>
      </Menu.Root>
    </ButtonGroup>
  );
}
