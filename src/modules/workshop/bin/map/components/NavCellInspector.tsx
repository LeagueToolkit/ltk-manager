import { useQueries } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { Grid, Stack } from "@/components";
import { m } from "@/i18n";
import { cellIndex, type NavGridOverlay, viewportQueries } from "@/modules/viewport";

import { useNavGrid } from "../hooks/useNavGrid";
import { useMapScene } from "../state/mapScene";
import {
  type ActiveOverlay,
  describeNavCell,
  navCellOf,
  overlaysChanging,
} from "../utils/navCells";

/** The digits of a flag word in hex. */
const WORD_DIGITS = 4;

/** The group name and the tag name of each region group. */
const REGION_COLUMNS = "max-content minmax(0, 1fr)";

/**
 * The selected navgrid cell: its position and height, the terrain tag that colors it with its
 * full flag word, its tag in each region group, and the overlays that changed it in the shown
 * state. Read-only, as every guide is. Per section 3.9 of docs/plans/navgrid-guides.md.
 *
 * It shows the lead if the lead is a cell, else the first selected cell, and nothing while the
 * selection holds no cell.
 */
export function NavCellInspector() {
  const { selected, lead } = useMapScene();
  const cell = cellOfSelection(lead, selected);
  if (cell === null) return null;

  return <CellReport x={cell[0]} y={cell[1]} />;
}

function CellReport({ x, y }: { x: number; y: number }) {
  const { backdrop, navGuide } = useMapScene();
  const view = useNavGrid(backdrop.navGrid, navGuide, backdrop.visibility.flags);
  const active = view?.active ?? [];
  const overlayFiles = active.flatMap((index) => {
    const overlay = view?.model.overlays[index];
    return [overlay?.flags ?? null, overlay?.regions ?? null];
  });
  const files = useQueries({
    queries: overlayFiles.map((file) => viewportQueries.navGrid(file)),
    combine: (results) =>
      results.map((result): NavGridOverlay | null =>
        result.data?.kind === "overlay" ? result.data.overlay : null,
      ),
  });

  if (view === null) {
    return (
      <span className="px-1 text-meta text-surface-400">
        {m.workshop_bin_map_navcell_loading_label()}
      </span>
    );
  }

  const report = describeNavCell(view.grid, view.model, x, y);
  const index = cellIndex(view.grid, x, y);
  if (report === null || index === null) return null;

  const overlays: ActiveOverlay[] = active.map((overlay, at) => ({
    index: overlay,
    files: [files[at * 2], files[at * 2 + 1]].filter((file) => file != null),
  }));
  const changing = overlaysChanging(view.base, overlays, index);
  const [centerX, height, centerZ] = report.center;

  return (
    <Stack as="section" gap={2} data-ui="NavCellInspector">
      <CellHeader>
        <span className="min-w-0 truncate text-row text-surface-100">
          {m.workshop_bin_map_navcell_title({ x, y })}
        </span>
        <span className="shrink-0 text-meta text-surface-400">
          {m.workshop_bin_map_guide_lock_hint()}
        </span>
      </CellHeader>

      <CellField label={m.workshop_bin_map_navcell_center_label()}>
        <span className="font-mono text-row text-surface-200 tabular-nums select-text">
          {`${centerX.toFixed(1)}, ${centerZ.toFixed(1)}`}
        </span>
      </CellField>

      <CellField label={m.workshop_bin_map_navcell_height_label()}>
        <span className="font-mono text-row text-surface-200 tabular-nums select-text">
          {height.toFixed(1)}
        </span>
      </CellField>

      <CellField label={m.workshop_bin_map_navcell_terrain_label()}>
        <span className="text-row text-surface-200 select-text">
          {report.terrain?.name ?? m.workshop_bin_map_navcell_no_tag_label()}
        </span>
        <span className="font-mono text-meta text-surface-400 select-text">
          {m.workshop_bin_map_navcell_word_label({ word: hex(report.word) })}
        </span>
        {report.untagged !== 0 && (
          <span className="font-mono text-meta text-warning-text select-text">
            {m.workshop_bin_map_navcell_untagged_label({ bits: hex(report.untagged) })}
          </span>
        )}
      </CellField>

      {report.regions.length > 0 && (
        <CellField label={m.workshop_bin_map_navcell_regions_label()}>
          <Grid columns={REGION_COLUMNS} gap={3} rowGap={0.5}>
            {report.regions.map(({ group, tag }) => [
              <span key={`${group.nameHash}:group`} className="text-row text-surface-400">
                {group.name}
              </span>,
              <span
                key={`${group.nameHash}:tag`}
                className="min-w-0 truncate text-row text-surface-200 select-text"
              >
                {tag?.name ?? m.workshop_bin_map_navcell_no_tag_label()}
              </span>,
            ])}
          </Grid>
        </CellField>
      )}

      <CellField label={m.workshop_bin_map_navcell_overlays_label()}>
        {changing.length === 0 && (
          <span className="text-row text-surface-400">
            {m.workshop_bin_map_navcell_overlays_empty()}
          </span>
        )}
        {changing.map((overlay) => (
          <span key={overlay} className="text-row text-surface-200 select-text">
            {view.model.overlays[overlay]?.label}
          </span>
        ))}
      </CellField>
    </Stack>
  );
}

/** Returns the cell that the inspector shows: the lead if it is a cell, else the first selected. */
function cellOfSelection(
  lead: string | null,
  selected: ReadonlySet<string>,
): [number, number] | null {
  const leading = lead === null ? null : navCellOf(lead);
  if (leading !== null) return leading;

  for (const id of selected) {
    const cell = navCellOf(id);
    if (cell !== null) return cell;
  }

  return null;
}

function hex(word: number): string {
  return `0x${word.toString(16).padStart(WORD_DIGITS, "0")}`;
}

function CellHeader({ children }: { children: ReactNode }) {
  return (
    <header className="flex min-w-0 items-center justify-between gap-2 px-1">{children}</header>
  );
}

function CellField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-1">
      <span className="text-meta text-surface-400">{label}</span>
      {children}
    </div>
  );
}
