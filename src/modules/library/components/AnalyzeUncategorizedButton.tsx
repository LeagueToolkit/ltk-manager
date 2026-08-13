import { SparkleIcon, SpinnerGapIcon } from "@phosphor-icons/react";

import { IconButton, Tooltip } from "@/components";
import {
  useAllModWadReports,
  useAnalyzeUncategorizedMods,
  useInstalledMods,
} from "@/modules/library";
import { useSettings } from "@/modules/settings";

interface AnalyzeUncategorizedButtonProps {
  /** Disable while the patcher is active or the library is still loading. */
  disabled?: boolean;
}

/**
 * Backfills WAD-footprint reports for mods that don't have one yet and looks
 * for missing RuneForge artwork across the library. Owns its own data — the
 * parent only gates it on patcher/loading state. Hidden when auto-categorization
 * is disabled because this control represents the combined detection action.
 */
export function AnalyzeUncategorizedButton({ disabled }: AnalyzeUncategorizedButtonProps) {
  const { data: allMods } = useInstalledMods();
  const { data: wadReports } = useAllModWadReports();
  const { data: settings } = useSettings();
  const analyze = useAnalyzeUncategorizedMods();

  if (settings && !settings.autoCategorizationEnabled) return null;

  const uncategorized = (allMods ?? []).filter((m) => !wadReports?.[m.id]);
  const mods = allMods ?? [];
  let tooltip = `Detect categories for ${uncategorized.length} mod${
    uncategorized.length === 1 ? "" : "s"
  } and find missing artwork`;
  if (uncategorized.length === 0) {
    tooltip = `Find missing artwork for ${mods.length} mod${mods.length === 1 ? "" : "s"}`;
  }

  let icon = <SparkleIcon className="h-4 w-4" weight="bold" />;
  if (analyze.isPending) {
    icon = <SpinnerGapIcon className="h-4 w-4 animate-spin" weight="bold" />;
  }

  return (
    <Tooltip content={tooltip}>
      <IconButton
        icon={icon}
        variant="ghost"
        size="sm"
        onClick={() => analyze.mutate({ uncategorized, artworkCandidates: mods })}
        disabled={disabled || analyze.isPending || mods.length === 0}
        aria-label="Detect mod categories and artwork"
      />
    </Tooltip>
  );
}
