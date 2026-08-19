import { SparkleIcon } from "@phosphor-icons/react";

import { IconButton, Tooltip } from "@/components";
import {
  useAllModWadReports,
  useAnalyzeUncategorizedMods,
  useInstalledMods,
} from "@/modules/library/api";
import { useSettings } from "@/modules/settings";

interface AnalyzeUncategorizedActionProps {
  /** Disable while the patcher is active or the library is still loading. */
  disabled?: boolean;
}

/**
 * Backfills WAD-footprint reports for mods that don't have one yet, so their
 * auto-detected champions/maps/tags populate. Owns its own data, and hides
 * entirely when auto-categorization is off, since the categories would go unused.
 */
export function AnalyzeUncategorizedAction({ disabled }: AnalyzeUncategorizedActionProps) {
  const { data: allMods } = useInstalledMods();
  const { data: wadReports } = useAllModWadReports();
  const { data: settings } = useSettings();
  const analyze = useAnalyzeUncategorizedMods();

  if (settings && !settings.autoCategorizationEnabled) return null;

  const uncategorized = (allMods ?? []).filter((m) => !wadReports?.[m.id]);
  const tooltip =
    uncategorized.length === 0
      ? "Every mod has been categorized"
      : `Detect champions, maps and tags for ${uncategorized.length} uncategorized mod${
          uncategorized.length === 1 ? "" : "s"
        }`;

  return (
    <Tooltip content={tooltip}>
      <IconButton
        icon={
          <div className="relative">
            <SparkleIcon weight="bold" className="h-4 w-4" />
            {uncategorized.length > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent-500" />
            )}
          </div>
        }
        variant="outline"
        size="sm"
        loading={analyze.isPending}
        disabled={disabled || uncategorized.length === 0}
        aria-label="Analyze uncategorized mods"
        onClick={() => analyze.mutate(uncategorized)}
      />
    </Tooltip>
  );
}
