import { type NavGrid, sampledHeightAt } from "@/modules/viewport";

/** The cell flag bits whose boundaries the Conformance view mode outlines. */
export const NAV_OUTLINE_BITS = {
  /** `GRASS` of `ltk_navgrid`. */
  brush: 0x1,
  /** `WALL` of `ltk_navgrid`, which every wall tag sets. */
  wall: 0x2,
} as const;

/**
 * Returns a line segment on each cell edge between a cell of `grid` with `bit` set and a cell
 * without it, six floats per segment, in the engine's space.
 *
 * Each end lies at the sampled height of `grid`. An end outside the samples lies at the mean
 * height of the two cells. An edge on the border of the grid has no segment.
 */
export function navCellOutlines(grid: NavGrid, bit: number): Float32Array {
  const { xCells, yCells, cellSize, flags, heights } = grid;
  const [minX, , minZ] = grid.min;
  const segments: number[] = [];

  const has = (cell: number) => (flags[cell] & bit) !== 0;
  const push = (x: number, z: number, cell: number, other: number) => {
    const height = sampledHeightAt(grid, x, z) ?? (heights[cell] + heights[other]) / 2;
    segments.push(x, height, z);
  };

  for (let y = 0; y < yCells; y += 1) {
    for (let x = 0; x < xCells; x += 1) {
      const cell = x + y * xCells;
      const left = minX + x * cellSize;
      const top = minZ + y * cellSize;

      const east = cell + 1;
      if (x + 1 < xCells && has(cell) !== has(east)) {
        push(left + cellSize, top, cell, east);
        push(left + cellSize, top + cellSize, cell, east);
      }

      const south = cell + xCells;
      if (y + 1 < yCells && has(cell) !== has(south)) {
        push(left, top + cellSize, cell, south);
        push(left + cellSize, top + cellSize, cell, south);
      }
    }
  }

  return new Float32Array(segments);
}
