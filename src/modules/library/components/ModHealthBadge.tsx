import {
  ArrowsClockwiseIcon,
  PlugsIcon,
  WarningCircleIcon,
  WrenchIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

import { Button, IconButton, Popover, Tooltip } from "@/components";
import { type ModHealthVerdict } from "@/lib/tauri";
import { useCheckModHealth, useModHealthVerdict, useRepairMod } from "@/modules/library";

interface ModHealthBadgeProps {
  modId: string;
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
  return `${total} ${findings}, and none can be repaired automatically. Look for an updated version of this mod.`;
}

/**
 * Pill on a mod card saying what a health check concluded, with the one-button
 * repair behind it.
 *
 * Renders nothing for a healthy or never-checked mod: a badge on every card
 * would bury the few that need one. Repairable is amber with the fixable
 * count, unrepairable is red with the finding count, and the popover carries
 * the plain-counts summary, the repair, and a re-check.
 */
export function ModHealthBadge({ modId }: ModHealthBadgeProps) {
  const { data: verdict } = useModHealthVerdict(modId);
  const check = useCheckModHealth();
  const repair = useRepairMod();

  if (!verdict || verdict.health === "healthy") return null;

  const repairable = verdict.health === "repairable";
  const PillIcon = repairable ? WrenchIcon : WarningCircleIcon;
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">
        {repairable ? "This mod needs a repair" : "This mod cannot be repaired"}
      </p>
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
              className={`h-6 gap-1 rounded-sm py-0.5 text-xs leading-tight font-medium ring-1 ring-inset ${pillClasses}`}
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="w-72">
            <div className="flex items-start justify-between gap-2 border-b border-surface-700/60 px-3 py-2">
              <div>
                <Popover.Title className="text-sm font-semibold text-surface-100">
                  Mod health
                </Popover.Title>
                <p className="mt-0.5 text-[0.625rem] text-surface-500">
                  Checked {formatDistanceToNow(new Date(verdict.checkedAt), { addSuffix: true })}
                </p>
              </div>
              <IconButton
                variant="ghost"
                size="sm"
                icon={
                  <ArrowsClockwiseIcon
                    weight="bold"
                    className={`h-3.5 w-3.5 ${check.isPending ? "animate-spin" : ""}`}
                  />
                }
                onClick={() => check.mutate(modId)}
                disabled={check.isPending || repair.isPending}
                aria-label="Re-check mod"
              />
            </div>
            <div className="flex flex-col gap-2 px-3 py-2">
              <p className="text-xs text-surface-200">{findingsSentence(verdict)}</p>
              {repairable && (
                <Button
                  variant="filled"
                  size="xs"
                  loading={repair.isPending}
                  onClick={() => repair.mutate(modId)}
                  className="self-start"
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
