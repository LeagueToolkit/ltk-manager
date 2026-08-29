import { ArrowsClockwiseIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useMemo, useRef } from "react";

import { Button, Dialog } from "@/components";
import { useAnalyzeModWads, useModWadReport } from "@/modules/library/api";

import type { ModCardView } from "./useModCardController";

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

function shortWadName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Which game WADs a mod patches, analyzed the first time someone opens it.
 *
 * Every card in the library renders this root, so the work has to stay behind
 * the open. `Dialog.Portal` unmounts its children while closed, which is what
 * lets [`WadFootprint`] analyze on mount and still leave an untouched library
 * untouched.
 */
export function ModWadFootprintDialog({
  view,
  open,
  onOpenChange,
}: {
  view: ModCardView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mod } = view;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Overlay size="md" data-ui="ModWadFootprintDialog">
          <Dialog.Header>
            <div className="min-w-0">
              <Dialog.Title>WAD footprint</Dialog.Title>
              <Dialog.Description className="truncate">{mod.displayName}</Dialog.Description>
            </div>
            <Dialog.Close className="shrink-0" />
          </Dialog.Header>
          <WadFootprint modId={mod.id} />
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WadFootprint({ modId }: { modId: string }) {
  const { data: report, isLoading } = useModWadReport(modId);
  const { mutate: analyze, isPending, isError } = useAnalyzeModWads();
  const requested = useRef(false);

  // StrictMode mounts an effect twice, and one opening is one analysis.
  useEffect(() => {
    if (isLoading || report || requested.current) return;
    requested.current = true;
    analyze(modId);
  }, [analyze, isLoading, modId, report]);

  const groups = useMemo(() => (report ? groupWadsByCategory(report.affectedWads) : []), [report]);

  if (!report && isError) {
    return (
      <>
        <Dialog.Body>
          <p className="text-sm leading-relaxed text-surface-300">
            This mod could not be analyzed.
          </p>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" size="sm" loading={isPending} onClick={() => analyze(modId)}>
            <ArrowsClockwiseIcon className="h-4 w-4" weight="bold" />
            Try again
          </Button>
        </Dialog.Footer>
      </>
    );
  }

  if (!report) {
    return (
      <Dialog.Body>
        <p className="flex items-center gap-2 text-sm text-surface-400">
          <SpinnerGapIcon className="h-4 w-4 animate-spin" />
          Reading this mod&apos;s files
        </p>
      </Dialog.Body>
    );
  }

  return (
    <>
      <Dialog.Body className="flex flex-col gap-3">
        <div>
          <p className="text-sm text-surface-200">
            {report.wadCount} WAD{report.wadCount === 1 ? "" : "s"} · {report.overrideCount}{" "}
            override{report.overrideCount === 1 ? "" : "s"}
          </p>
          <p className="mt-0.5 text-xs text-surface-500">
            Analyzed {formatDistanceToNow(new Date(report.computedAt), { addSuffix: true })}
          </p>
          {report.isStale && (
            <p className="mt-1 text-xs text-warning-text">
              May be outdated. Re-analyze or patch to refresh.
            </p>
          )}
        </div>

        {groups.length === 0 && (
          <p className="text-sm text-surface-400">This mod patches no game WADs.</p>
        )}
        {groups.length > 0 && (
          <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {groups.map((group) => (
              <CategorySection key={group.label} group={group} />
            ))}
          </div>
        )}
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant="outline" size="sm" loading={isPending} onClick={() => analyze(modId)}>
          <ArrowsClockwiseIcon className="h-4 w-4" weight="bold" />
          Re-analyze
        </Button>
      </Dialog.Footer>
    </>
  );
}

function CategorySection({ group }: { group: CategoryGroup }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-surface-400 uppercase select-none">
        {group.label} · {group.wads.length}
      </div>
      <ul className="mt-0.5 text-meta">
        {group.wads.map((wad) => (
          <li key={wad} className="truncate font-mono text-code text-surface-300" title={wad}>
            {shortWadName(wad)}
          </li>
        ))}
      </ul>
    </div>
  );
}
