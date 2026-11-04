/**
 * Selects, snaps to and describes the cells of a navigation grid. Every position is in the
 * engine's space. Per sections 3.9 and 3.10 of docs/plans/navgrid-guides.md.
 */

import {
  cellAt,
  cellCenter,
  cellIndex,
  type NavGrid,
  type NavGridColorConfig,
  type NavGridOverlay,
  type NavGridOverlayRect,
  type NavRegionGroup,
  type NavRegionTag,
  type NavTerrainTag,
  regionTagOf,
  sampledHeightAt,
  terrainTagOf,
  withinCutoff,
} from "@/modules/viewport";

type Vec3 = [number, number, number];

/** What a cell guide's selection id starts with, apart from a mesh's and a placeable's. */
const NAV_CELL_PREFIX = "navcell:";

/** The selection id of the navgrid cell `x`, `y`. */
export function navCellId(x: number, y: number): string {
  return `${NAV_CELL_PREFIX}${x},${y}`;
}

/** Returns the cell `x`, `y` that a selection id names, or null for any other id. */
export function navCellOf(id: string): [number, number] | null {
  if (!id.startsWith(NAV_CELL_PREFIX)) return null;

  const parts = id.slice(NAV_CELL_PREFIX.length).split(",");
  if (parts.length !== 2) return null;

  const [x, y] = parts.map(Number);
  const valid = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0;
  return valid ? [x, y] : null;
}

/**
 * Returns the cell `x`, `y` under `point`, where a click ray meets the drawn map, or null if the
 * navgrid projection leaves the point untinted.
 *
 * Returns null outside the cells, and if `point` is more than `cutoff` units above the sampled
 * height under it.
 */
export function pickNavCell(
  grid: NavGrid,
  point: readonly [number, number, number],
  cutoff: number | null,
): [number, number] | null {
  const [x, y, z] = point;
  const cell = cellAt(grid, x, z);
  if (cell === null) return null;

  return withinCutoff(y, sampledHeightAt(grid, x, z), cutoff) ? cell : null;
}

/** Returns the position of `position`'s cell center at the cell height, or null outside the cells. */
export function snapToNavCell(
  grid: NavGrid,
  position: readonly [number, number, number],
): Vec3 | null {
  const cell = cellAt(grid, position[0], position[2]);
  return cell === null ? null : cellCenter(grid, cell[0], cell[1]);
}

/** One overlay that is on, by its index in the model's overlay list, with its decoded files. */
export interface ActiveOverlay {
  readonly index: number;
  /** The flag file before the region file, as the guide applies them. */
  readonly files: readonly NavGridOverlay[];
}

/**
 * Returns the indices of the overlays among `overlays` that change cell `cell` of `base`, in
 * list order.
 *
 * The overlays apply in order, as `applyOverlays` writes them. An overlay changes the cell if
 * one of its rectangles writes a value other than the value that the cell holds at that point.
 */
export function overlaysChanging(
  base: NavGrid,
  overlays: readonly ActiveOverlay[],
  cell: number,
): number[] {
  const x = cell % base.xCells;
  const y = Math.floor(cell / base.xCells);
  let flags = base.flags[cell];
  let regions = base.regionTags[cell];
  const changing: number[] = [];

  for (const { index, files } of overlays) {
    let changed = false;
    for (const file of files) {
      for (const rect of file.rects) {
        const value = rectValueAt(rect, x, y);
        if (value === null) continue;

        if (file.kind === "flags" && value !== flags) {
          flags = value;
          changed = true;
        } else if (file.kind === "regions" && value !== regions) {
          regions = value;
          changed = true;
        }
      }
    }

    if (changed) changing.push(index);
  }

  return changing;
}

/** The tag of one region group at a cell. */
export interface NavCellRegion {
  readonly group: NavRegionGroup;
  /** Null if the cell's grid tag has no config tag of the same name. */
  readonly tag: NavRegionTag | null;
}

/** What the inspector shows of one cell, per section 3.9 of docs/plans/navgrid-guides.md. */
export interface NavCellReport {
  readonly x: number;
  readonly y: number;
  /** The world center of the cell, at the cell height. */
  readonly center: Vec3;
  /** The flag word of the cell. */
  readonly word: number;
  /** The terrain tag that colors the cell, or null if no tag matches. */
  readonly terrain: NavTerrainTag | null;
  /** The bits of `word` that no terrain tag has. */
  readonly untagged: number;
  readonly regions: readonly NavCellRegion[];
}

/** Returns what the inspector shows of cell `x`, `y` of `grid`, or null outside the cells. */
export function describeNavCell(
  grid: NavGrid,
  config: NavGridColorConfig,
  x: number,
  y: number,
): NavCellReport | null {
  const index = cellIndex(grid, x, y);
  const center = cellCenter(grid, x, y);
  if (index === null || center === null) return null;

  const word = grid.flags[index];
  const tagged = config.terrainTags.reduce((bits, tag) => bits | tag.flags, 0);

  return {
    x,
    y,
    center,
    word,
    terrain: terrainTagOf(config.terrainTags, word),
    untagged: word & ~tagged,
    regions: config.regionGroups.map((group) => ({ group, tag: regionTagOf(grid, group, index) })),
  };
}

/** Returns the value that `rect` holds for cell `x`, `y`, or null if it does not cover the cell. */
function rectValueAt(
  rect: NavGridOverlayRect<Uint16Array | Uint32Array>,
  x: number,
  y: number,
): number | null {
  if (rect.width === 0) return null;

  const column = x - rect.x;
  const row = y - rect.y;
  const rows = Math.min(rect.height, Math.floor(rect.values.length / rect.width));
  if (column < 0 || column >= rect.width || row < 0 || row >= rows) return null;

  return rect.values[row * rect.width + column];
}
