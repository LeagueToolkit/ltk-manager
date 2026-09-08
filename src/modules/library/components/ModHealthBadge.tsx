import {
  ArrowsClockwiseIcon,
  type Icon,
  PlugsIcon,
  WarningCircleIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

import { Button, IconButton, Popover, ShockedPoroDuotoneIcon, Tooltip } from "@/components";
import { type ModHealthVerdict } from "@/lib/tauri";

import {
  useCheckModHealth,
  useHealthCheckReadiness,
  useModHealthVerdict,
  useRepairMod,
} from "../api";
import { alarmOf, type SweepAlarm, toneOf } from "./modHealthNotice";

interface ModHealthBadgeProps {
  modId: string;
}

/**
 * The header glyph, at twice the size of the pill's.
 *
 * `ModHealthSweepPanel`'s [`PanelMark`] for one mod: the poro for what no repair
 * reaches, and the wrench for what one does. The poro's hue is the rung, so a
 * mod that still loads gets the same drawing without the alarm. The pill keeps
 * the phosphor glyph either way, since the poro is a drawing and 16px is not
 * enough of it to read.
 */
function PopoverMark({ alarm, tone }: { alarm: SweepAlarm; tone: string }) {
  if (alarm === "repairable") {
    return <WrenchIcon className={`h-10 w-10 shrink-0 ${tone}`} weight="duotone" />;
  }

  return <ShockedPoroDuotoneIcon className={`h-10 w-10 shrink-0 ${tone}`} />;
}

/**
 * Run the check again, from a verdict already on screen.
 *
 * Its own component so that the readiness it asks for is asked from inside the
 * popover: the badge is mounted for every card in the library, and this is
 * mounted only where someone can press it.
 */
function RecheckButton({ modId, repairing }: { modId: string; repairing: boolean }) {
  const check = useCheckModHealth();
  const readiness = useHealthCheckReadiness();

  return (
    <IconButton
      variant="ghost"
      size="sm"
      compact
      icon={
        <ArrowsClockwiseIcon
          weight="bold"
          className={`h-4 w-4 ${check.isPending ? "animate-spin" : ""}`}
        />
      }
      onClick={() => check.mutate(modId)}
      /* A verdict outlives the tables it was taken against, so this popover can
         open on a launch that has none. */
      disabled={check.isPending || repairing || readiness !== "ready"}
      aria-label="Re-check mod"
    />
  );
}

function totalFindings(verdict: ModHealthVerdict): number {
  const { fatals, errors, warnings, infos } = verdict.counts;
  return fatals + errors + warnings + infos;
}

/** The glyph each rung wears, matching the status bar cell's. */
const GLYPHS: Record<SweepAlarm, Icon> = {
  repairable: WrenchIcon,
  broken: WarningCircleIcon,
  flagged: WarningIcon,
};

/**
 * The headline, which is the verdict in the reader's own terms.
 *
 * The two unrepairable rungs say different things because their readers have
 * different problems: one has to go and find a replacement, and the other has a
 * mod they should keep and play.
 */
const HEADLINES: Record<SweepAlarm, string> = {
  repairable: "This mod needs a repair",
  broken: "This mod cannot be repaired",
  flagged: "This mod loads with a fault",
};

function findingsSentence(verdict: ModHealthVerdict, alarm: SweepAlarm): string {
  const total = totalFindings(verdict);
  const findings = `finding${total === 1 ? "" : "s"}`;
  if (alarm === "repairable") {
    return verdict.fixable === total
      ? `${total} ${findings}, all repairable automatically.`
      : `${verdict.fixable} of ${total} ${findings} can be repaired automatically.`;
  }
  if (alarm === "broken") {
    return "We found issues with this mod that cannot be repaired, look for a new version.";
  }
  return `${total} ${findings} a repair cannot reach. Nothing here stops the mod loading.`;
}

function pillLabel(verdict: ModHealthVerdict, alarm: SweepAlarm): string {
  if (alarm === "repairable") {
    const { fixable } = verdict;
    return `${fixable} repairable finding${fixable === 1 ? "" : "s"}, click to repair`;
  }
  const total = totalFindings(verdict);
  const findings = `finding${total === 1 ? "" : "s"}`;
  if (alarm === "broken") return `${total} unrepairable ${findings}, click for details`;
  return `${total} ${findings} no repair reaches, click for details`;
}

/**
 * Pill on a mod card saying what a health check concluded, with the one-button
 * repair behind it.
 *
 * Renders nothing for a healthy or never-checked mod: a badge on every card
 * would bury the few that need one. The hue is the rung, per "How loud a
 * finding is drawn" in docs/ux/MOD_HEALTH.md, and the popover behind the pill
 * announces the verdict in `ModHealthSweepPanel`'s header language, with the
 * repair and a re-check.
 */
export function ModHealthBadge({ modId }: ModHealthBadgeProps) {
  const { data: verdict } = useModHealthVerdict(modId);
  const repair = useRepairMod();

  if (!verdict || verdict.health === "healthy") return null;

  const alarm = alarmOf(verdict);
  const tone = toneOf(alarm);
  const PillIcon = GLYPHS[alarm];
  const headline = HEADLINES[alarm];
  const sentence = findingsSentence(verdict, alarm);
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">{headline}</p>
      <p className="text-xs text-surface-200">{sentence}</p>
      <p className="text-xs text-surface-300">Click for details.</p>
    </div>
  );

  return (
    <Popover.Root>
      <Tooltip content={tooltipContent}>
        <Popover.Trigger
          render={
            <IconButton
              compact
              variant="ghost"
              size="sm"
              icon={<PillIcon className="h-4 w-4" weight="bold" />}
              aria-label={pillLabel(verdict, alarm)}
              className={`h-6 gap-1 rounded py-0.5 text-xs leading-tight font-medium ring-1 ring-inset ${tone.pill}`}
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="w-72 overflow-hidden">
            <div
              className={`relative flex items-start gap-2.5 px-3 py-2.5 select-none ${tone.wash}`}
            >
              <PopoverMark alarm={alarm} tone={tone.chip} />
              <div className="min-w-0 flex-1">
                <Popover.Title className="font-medium">{headline}</Popover.Title>
                <p className="text-xs text-surface-300">{sentence}</p>
              </div>
              <RecheckButton modId={modId} repairing={repair.isPending} />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${tone.rule}`}
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1 select-none">
              <p className="text-[0.625rem] text-surface-500">
                Checked {formatDistanceToNow(new Date(verdict.checkedAt), { addSuffix: true })}
              </p>
              {alarm === "repairable" && (
                <Button
                  variant="filled"
                  size="xs"
                  loading={repair.isPending}
                  onClick={() => repair.mutate(modId)}
                >
                  <PlugsIcon className="h-4 w-4" weight="duotone" />
                  Repair
                </Button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
