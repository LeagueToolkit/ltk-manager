import {
  ArrowsClockwiseIcon,
  PlugsIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

import { Button, IconButton, Popover, ShockedPoroDuotoneIcon, Tooltip } from "@/components";
import { type ModHealthVerdict } from "@/lib/tauri";
import { useCheckModHealth, useModHealthVerdict, useRepairMod } from "@/modules/library";

import { toneOf } from "./modHealthNotice";

interface ModHealthBadgeProps {
  modId: string;
}

/**
 * The header glyph, at twice the size of the pill's.
 *
 * `ModHealthSweepPanel`'s [`PanelMark`] for one mod: the poro for what no repair
 * reaches, and the wrench for what one does. The pill keeps the phosphor glyph
 * either way, since the poro is a drawing and 16px is not enough of it to read.
 */
function PopoverMark({ repairable, tone }: { repairable: boolean; tone: string }) {
  if (repairable) return <WrenchIcon className={`h-10 w-10 shrink-0 ${tone}`} weight="duotone" />;

  return <ShockedPoroDuotoneIcon className={`h-10 w-10 shrink-0 ${tone}`} />;
}

function totalFindings(verdict: ModHealthVerdict): number {
  const { fatals, errors, warnings, infos } = verdict.counts;
  return fatals + errors + warnings + infos;
}

function findingsSentence(verdict: ModHealthVerdict): string {
  const total = totalFindings(verdict);
  const findings = `finding${total === 1 ? "" : "s"}`;
  if (verdict.health === "repairable") {
    return verdict.fixable === total
      ? `${total} ${findings}, all repairable automatically.`
      : `${verdict.fixable} of ${total} ${findings} can be repaired automatically.`;
  }
  return "We found issues with this mod that cannot be repaired, look for a new version.";
}

/**
 * Pill on a mod card saying what a health check concluded, with the one-button
 * repair behind it.
 *
 * Renders nothing for a healthy or never-checked mod: a badge on every card
 * would bury the few that need one. Repairable is amber and unrepairable is
 * red, and the popover behind either announces the verdict in
 * `ModHealthSweepPanel`'s header language, with the repair and a re-check.
 */
export function ModHealthBadge({ modId }: ModHealthBadgeProps) {
  const { data: verdict } = useModHealthVerdict(modId);
  const check = useCheckModHealth();
  const repair = useRepairMod();

  if (!verdict || verdict.health === "healthy") return null;

  const repairable = verdict.health === "repairable";
  const PillIcon = repairable ? WrenchIcon : WarningCircleIcon;
  const headline = repairable ? "This mod needs a repair" : "This mod cannot be repaired";
  const tone = toneOf(repairable ? 1 : 0);
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">{headline}</p>
      <p className="text-xs text-surface-200">{findingsSentence(verdict)}</p>
      <p className="text-xs text-surface-300">Click for details.</p>
    </div>
  );

  const pillClasses = repairable
    ? "bg-warning/15 text-warning-text ring-warning/30 hover:bg-warning/25"
    : "bg-danger/15 text-danger-text ring-danger/30 hover:bg-danger/25";

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
              aria-label={
                repairable
                  ? `${verdict.fixable} repairable finding${verdict.fixable === 1 ? "" : "s"}, click to repair`
                  : `${totalFindings(verdict)} unrepairable finding${totalFindings(verdict) === 1 ? "" : "s"}, click for details`
              }
              className={`h-6 gap-1 rounded py-0.5 text-xs leading-tight font-medium ring-1 ring-inset ${pillClasses}`}
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
              <PopoverMark repairable={repairable} tone={tone.chip} />
              <div className="min-w-0 flex-1">
                <Popover.Title className="font-medium">{headline}</Popover.Title>
                <p className="text-xs text-surface-300">{findingsSentence(verdict)}</p>
              </div>
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
                disabled={check.isPending || repair.isPending}
                aria-label="Re-check mod"
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${tone.rule}`}
              />
            </div>
            <div className="flex items-center justify-between gap-2 px-3 py-1 select-none">
              <p className="text-[0.625rem] text-surface-500">
                Checked {formatDistanceToNow(new Date(verdict.checkedAt), { addSuffix: true })}
              </p>
              {repairable && (
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
