import { formatDistanceToNow } from "date-fns";
import { HardDrive, Loader2, RefreshCw } from "lucide-react";
import { useMemo } from "react";

import { Button, IconButton, Popover, Skeleton, Tooltip } from "@/components";
import { useAnalyzeModWads, useModWadReport } from "@/modules/library";
import { useSettings } from "@/modules/settings";

interface WadCountBadgeProps {
  modId: string;
}

interface CategoryGroup {
  label: string;
  wads: string[];
}

/**
 * Group affected WAD paths by their top-level game directory segment.
 * Only matches exact path segments to avoid false positives on names like
 * "Old_Champions". Falls back to "Other" for unrecognized paths.
 */
function groupWadsByCategory(wads: string[]): CategoryGroup[] {
  const champions: string[] = [];
  const maps: string[] = [];
  const ui: string[] = [];
  const other: string[] = [];

  for (const wad of wads) {
    const segments = wad.replace(/\\/g, "/").split("/");
    const category = segments.find((s) => s !== "" && s !== "DATA" && s !== "FINAL");
    const lower = category?.toLowerCase();

    if (lower === "champions") {
      champions.push(wad);
    } else if (lower === "maps") {
      maps.push(wad);
    } else if (lower === "ux" || lower === "ui") {
      ui.push(wad);
    } else {
      other.push(wad);
    }
  }

  return [
    { label: "Champions", wads: champions },
    { label: "Maps", wads: maps },
    { label: "UI", wads: ui },
    { label: "Other", wads: other },
  ].filter((g) => g.wads.length > 0);
}

/**
 * Color tiering for the WAD count pill.
 * Uses Tailwind amber for the "high" tier since the project has no
 * dedicated warning token in the design system.
 */
function tierClasses(count: number): string {
  if (count >= 26) {
    return "bg-warning/15 text-warning-text ring-1 ring-inset ring-warning/30 hover:bg-warning/25";
  }
  if (count >= 6) {
    return "bg-accent-500/15 text-accent-300 ring-1 ring-inset ring-accent-500/30 hover:bg-accent-500/25";
  }
  return "bg-surface-700/60 text-surface-300 hover:bg-surface-600/60";
}

function shortWadName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Compact pill rendered next to `LayerPopover` on each mod card. Owns its own
 * data via `useModWadReport`, so the parent passes only the mod id.
 *
 * States:
 * - **Loading**: skeleton placeholder matching badge dimensions.
 * - **Unknown**: never analyzed, so it renders a "?" pill with an Analyze action.
 * - **Known**: numeric pill with a color tier, opening a popover with the full
 *   list grouped by category and a Re-analyze button. Stale reports get a
 *   refresh-icon overlay.
 */
export function WadCountBadge({ modId }: WadCountBadgeProps) {
  const { data: report, isLoading } = useModWadReport(modId);
  const { data: settings } = useSettings();
  const analyze = useAnalyzeModWads();

  const groups = useMemo(() => (report ? groupWadsByCategory(report.affectedWads) : []), [report]);

  if (!settings?.showWadFootprint) return null;

  if (isLoading) {
    return <Skeleton width={36} height={24} rounded />;
  }

  if (!report) {
    return <UnknownBadge modId={modId} pending={analyze.isPending} onAnalyze={analyze.mutate} />;
  }

  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">WAD footprint</p>
      <p className="text-xs text-surface-200">
        Number of game WAD files this mod patches. Click for the full list.
      </p>
      <p className="text-xs text-surface-300">
        {report.wadCount} WAD{report.wadCount === 1 ? "" : "s"}
        {report.isStale && " · may be outdated"}
      </p>
    </div>
  );

  return (
    <Popover.Root>
      <Tooltip content={tooltipContent}>
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="xs"
              aria-label={`Affects ${report.wadCount} WADs, click for details`}
              className={`relative h-6 gap-1 rounded px-2 py-0.5 text-xs leading-tight ${tierClasses(report.wadCount)}`}
            >
              <HardDrive className="h-3 w-3" />
              {report.wadCount}
              {report.isStale && <RefreshCw className="h-3 w-3 text-warning-text" aria-hidden />}
            </Button>
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup className="w-80 max-w-[24rem]">
            <div className="flex items-start justify-between gap-2 border-b border-surface-700/60 px-3 py-2">
              <div>
                <Popover.Title className="text-sm font-semibold text-surface-100">
                  WAD footprint
                </Popover.Title>
                <p className="text-xs text-surface-400">
                  {report.wadCount} WAD{report.wadCount === 1 ? "" : "s"} · {report.overrideCount}{" "}
                  override{report.overrideCount === 1 ? "" : "s"}
                </p>
                <p className="mt-0.5 text-[10px] text-surface-500">
                  {formatDistanceToNow(new Date(report.computedAt), { addSuffix: true })}
                </p>
                {report.isStale && (
                  <p className="mt-0.5 text-[10px] text-warning-text">
                    May be outdated. Re-analyze or patch to refresh.
                  </p>
                )}
              </div>
              <IconButton
                variant="ghost"
                size="sm"
                icon={
                  analyze.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )
                }
                onClick={() => analyze.mutate(modId)}
                disabled={analyze.isPending}
                aria-label="Re-analyze mod"
              />
            </div>
            <div className="max-h-72 overflow-y-auto px-3 py-2">
              {groups.length === 0 && <p className="text-xs text-surface-500">No WADs affected.</p>}
              {groups.map((group) => (
                <CategorySection key={group.label} group={group} />
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function CategorySection({ group }: { group: CategoryGroup }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 text-[10px] font-semibold tracking-wide text-surface-400 uppercase">
        {group.label} · {group.wads.length}
      </div>
      <ul className="space-y-0.5">
        {group.wads.map((wad) => (
          <li key={wad} className="truncate font-mono text-[11px] text-surface-300" title={wad}>
            {shortWadName(wad)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnknownBadge({
  modId,
  pending,
  onAnalyze,
}: {
  modId: string;
  pending: boolean;
  onAnalyze: (modId: string) => void;
}) {
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">WAD footprint</p>
      <p className="text-xs text-surface-200">
        Shows how many game WAD files this mod patches. Not yet computed. Click to analyze.
      </p>
    </div>
  );
  return (
    <Tooltip content={tooltipContent}>
      <IconButton
        variant="ghost"
        size="xs"
        icon={
          pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <HardDrive className="h-3 w-3" />
        }
        onClick={(e) => {
          e.stopPropagation();
          onAnalyze(modId);
        }}
        disabled={pending}
        aria-label="Analyze mod WAD footprint"
        className="h-6 rounded bg-surface-700/40 px-2 text-xs text-surface-400 hover:bg-surface-600/60 hover:text-surface-200"
      />
    </Tooltip>
  );
}
