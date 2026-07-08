import { Loader2, Sparkles } from "lucide-react";

import { IconButton, Tooltip } from "@/components";
import {
  useAllModWadReports,
  useAnalyzeUncategorizedMods,
  useInstalledMods,
} from "@/modules/library/api";
import { useSettings } from "@/modules/settings";

interface AnalyzeUncategorizedButtonProps {
  /** Disable while the patcher is active or the library is still loading. */
  disabled?: boolean;
}

/**
 * Backfills WAD-footprint reports for mods that don't have one yet, so their
 * auto-detected champions/maps/tags populate. Owns its own data — the parent
 * only gates it on patcher/loading state. Hidden entirely when auto-categorization
 * is disabled in settings, since the detected categories would go unused.
 */
export function AnalyzeUncategorizedButton({ disabled }: AnalyzeUncategorizedButtonProps) {
  const { data: allMods } = useInstalledMods();
  const { data: wadReports } = useAllModWadReports();
  const { data: settings } = useSettings();
  const analyze = useAnalyzeUncategorizedMods();

  if (settings && !settings.autoCategorizationEnabled) return null;

  const uncategorized = (allMods ?? []).filter((m) => !wadReports?.[m.id]);
  const tooltip =
    uncategorized.length === 0
      ? "Every mod has been categorized"
      : `Detect champions, maps & tags for ${uncategorized.length} uncategorized mod${
          uncategorized.length === 1 ? "" : "s"
        }`;

  return (
    <Tooltip content={tooltip}>
      <IconButton
        icon={
          analyze.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )
        }
        variant="ghost"
        size="sm"
        onClick={() => analyze.mutate(uncategorized)}
        disabled={disabled || analyze.isPending || uncategorized.length === 0}
        aria-label="Analyze uncategorized mods"
      />
    </Tooltip>
  );
}
