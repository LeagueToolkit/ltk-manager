import { PackageX } from "lucide-react";

import { Tooltip } from "@/components";
import { useLinkedBinOffender } from "@/modules/library";
import { useSettings } from "@/modules/settings";
import { useLinkedBinGuardStore } from "@/stores";

interface MissingDepsBadgeProps {
  modId: string;
  enabled: boolean;
}

/**
 * Amber pill on a mod card flagging that the mod's property-bins reference linked
 * dependencies that didn't resolve in the most recent overlay build. Clicking it
 * opens the reachable {@link LinkedBinWarningDialog} to review or disable.
 *
 * Passive by design, so it never blocks patching (missing linked bins are non-fatal at
 * injection). Hidden for disabled mods (they're excluded from the build, so any prior
 * flag is stale) and when the dependency check is turned off in settings.
 */
export function MissingDepsBadge({ modId, enabled }: MissingDepsBadgeProps) {
  const { data: settings } = useSettings();
  const { data: offender } = useLinkedBinOffender(modId);
  const openDialog = useLinkedBinGuardStore((s) => s.openDialog);

  if (!enabled) return null;
  if (settings?.linkedBinCheckEnabled === false) return null;
  if (!offender) return null;

  const count = offender.missingLinks.length;
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">Missing dependencies</p>
      <p className="text-xs text-surface-200">
        References {count} game file{count === 1 ? "" : "s"} that aren&apos;t installed. League may
        glitch or crash when it loads this mod. Click to review or disable.
      </p>
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        onClick={openDialog}
        aria-label={`${count} missing ${count === 1 ? "dependency" : "dependencies"}, click to review`}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs leading-tight font-medium text-warning-text ring-1 ring-warning/30 transition-colors ring-inset hover:bg-warning/25"
      >
        <PackageX className="h-3 w-3" />
        {count}
      </button>
    </Tooltip>
  );
}
