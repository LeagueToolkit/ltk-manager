import { ChevronDown, ChevronsRight } from "lucide-react";

import { Button, ButtonGroup, IconButton, Kbd, LeagueIcon, Menu, Tooltip } from "@/components";
import { useHddWarning, usePlatformSupport } from "@/hooks";
import { useLaunchAvailability, usePlay } from "@/modules/launcher";
import { useInstalledMods } from "@/modules/library/api";
import { useGuardedStartPatcher, usePatcherStatus, useStopPatcher } from "@/modules/patcher";
import { useSettings } from "@/modules/settings";
import { usePatcherSessionStore } from "@/stores";

interface PlayButtonProps {
  /** Set while a library action that must not overlap a patch is in progress. */
  disabled?: boolean;
}

function playLabel(
  step: ReturnType<typeof usePlay>["step"],
  isBuilding: boolean,
  patcherOnly: boolean,
): string {
  if (step === "launching") return "Launching...";
  if (isBuilding) return "Building...";
  if (step === "starting-patcher") return "Starting...";
  if (patcherOnly) return "Start Patcher";
  return "Play";
}

function primaryTooltip(
  patcherOnly: boolean,
  leagueRunning: boolean,
  hasEnabledMods: boolean,
): string {
  if (leagueRunning && !hasEnabledMods)
    return "League is already running - enable a mod to patch it";
  if (leagueRunning) return "League is already running - your mods will apply to your next game";
  if (patcherOnly && !hasEnabledMods) return "No mods are enabled - there is nothing to patch";
  if (patcherOnly) return "Start the patcher, then launch League yourself";
  if (!hasEnabledMods) return "No mods are enabled - League will launch unmodded";
  return "Start the patcher and launch League";
}

/**
 * The League mark deliberately overflows `Button`'s icon slot. It is the brand
 * on the app's primary action, not a glyph labelling it, so it is sized past
 * what the surrounding lucide icons sit at.
 */
function PrimaryIcon({ patcherOnly }: { patcherOnly: boolean }) {
  if (patcherOnly) return <ChevronsRight className="h-5 w-5 shrink-0" />;
  return <LeagueIcon className="h-6 w-6 shrink-0" />;
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
  const icon = <LeagueIcon className="h-4 w-4" />;

  if (leagueRunning) {
    return (
      <Menu.Item icon={icon} disabled>
        {label}
        <span className="ml-2 text-xs text-surface-500">already running</span>
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
 */
export function PlayButton({ disabled = false }: PlayButtonProps) {
  const { data: platform } = usePlatformSupport();
  const { data: mods = [], isLoading } = useInstalledMods();
  const { data: status } = usePatcherStatus();
  const { data: availability } = useLaunchAvailability();
  const { data: settings } = useSettings();
  const { play, launchOnly, step, isBusy } = usePlay();
  const { start: startPatcher } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const stopping = usePatcherSessionStore((s) => s.stopping);
  const maybeShowHddWarning = useHddWarning();

  const isRunning = status?.running ?? false;
  const isBuilding = status?.phase === "building";
  const hasEnabledMods = mods.some((m) => m.enabled);
  const canLaunch = availability?.canLaunch ?? false;
  const leagueRunning = availability?.leagueRunning ?? false;

  async function handleStartPatcherOnly() {
    await maybeShowHddWarning();
    await startPatcher({});
  }

  // With nothing enabled there is no overlay worth building, so Play collapses
  // to a plain launch rather than spending a build on an empty mod list.
  const handlePlay = hasEnabledMods ? play : launchOnly;

  // Settings still loading reads as classic: it is the default, and it is the
  // safer guess - a button that turns out not to launch beats one that launches
  // when the user never asked it to.
  const classic = settings?.launchMode !== "modern";

  // A running client puts the launcher in the same place classic does, since
  // launching into it is a no-op and the button would be promising something it
  // cannot do. The menu stays, though - the launcher was still asked for.
  const patcherOnly = classic || leagueRunning;

  const primaryAction = patcherOnly ? handleStartPatcherOnly : handlePlay;

  // Both halves are Windows-only, so there is nothing to offer elsewhere.
  // `PatcherUnsupported` already explains why on the page itself.
  if (!(platform?.patcherAvailable ?? true)) return null;

  if (isRunning && !isBusy) {
    const stopButton = (
      <Tooltip
        content={
          <>
            {stopping && "Stopping the patcher..."}
            {!stopping && (
              <>
                Stop patcher <Kbd shortcut="Ctrl+P" />
              </>
            )}
          </>
        }
      >
        <Button
          variant="outline"
          size="md"
          onClick={() => stopPatcher.mutate()}
          loading={stopping}
          disabled={disabled || stopping}
          left={
            !stopping && (
              <span className="inline-flex h-3 w-3 rounded-full bg-success shadow-[0_0_5px_1px] shadow-success/50" />
            )
          }
        >
          {stopping ? "Stopping..." : "Stop Patcher"}
        </Button>
      </Tooltip>
    );

    if (classic) return stopButton;

    return (
      <ButtonGroup>
        {stopButton}
        <Menu.Root>
          <Menu.Trigger
            render={
              <IconButton
                icon={<ChevronDown className="h-4 w-4" />}
                variant="outline"
                size="md"
                aria-label="More launch options"
                className="w-auto px-2"
              />
            }
          />
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup className="w-64">
                <LaunchMenuItem
                  label="Launch League"
                  leagueRunning={leagueRunning}
                  onClick={launchOnly}
                  disabled={!canLaunch || isBusy}
                />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </ButtonGroup>
    );
  }

  const busy = isLoading || disabled || isBusy || isBuilding;

  const primaryButton = (
    <Tooltip
      content={
        <>
          {primaryTooltip(patcherOnly, leagueRunning, hasEnabledMods)}{" "}
          {patcherOnly && <Kbd shortcut="Ctrl+P" />}
        </>
      }
    >
      <Button
        variant="filled"
        size="md"
        onClick={primaryAction}
        loading={isBusy || isBuilding}
        disabled={busy || (patcherOnly && !hasEnabledMods)}
        left={<PrimaryIcon patcherOnly={patcherOnly} />}
        className="gap-3"
      >
        {playLabel(step, isBuilding, patcherOnly)}
      </Button>
    </Tooltip>
  );

  if (classic) return primaryButton;

  return (
    <ButtonGroup>
      {primaryButton}
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<ChevronDown className="h-4 w-4" />}
              variant="filled"
              size="md"
              disabled={busy}
              aria-label="More launch options"
              className="w-auto px-2"
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup className="w-64">
              {patcherOnly && (
                <LaunchMenuItem
                  label="Play"
                  leagueRunning={leagueRunning}
                  onClick={handlePlay}
                  disabled={!canLaunch}
                />
              )}
              {!patcherOnly && (
                <Menu.Item
                  icon={<ChevronsRight className="h-4 w-4" />}
                  onClick={handleStartPatcherOnly}
                  disabled={!hasEnabledMods}
                  shortcut="Ctrl+P"
                >
                  Start patcher only
                </Menu.Item>
              )}
              <LaunchMenuItem
                label="Launch League only"
                leagueRunning={leagueRunning}
                onClick={launchOnly}
                disabled={!canLaunch}
              />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}
