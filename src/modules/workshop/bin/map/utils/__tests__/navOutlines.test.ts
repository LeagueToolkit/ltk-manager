import { describe, expect, it } from "vitest";

import type { NavGrid } from "@/modules/viewport";

import { NAV_OUTLINE_BITS, navCellOutlines } from "../navOutlines";

/** Cells of 10 units from the origin, with samples 10 units apart at height `x + 2z`. */
function gridOf(xCells: number, yCells: number, flags: readonly number[], sampled = true): NavGrid {
  const xSamples = sampled ? xCells + 1 : 0;
  const ySamples = sampled ? yCells + 1 : 0;
  const samples = new Float32Array(xSamples * ySamples);
  for (let j = 0; j < ySamples; j += 1) {
    for (let i = 0; i < xSamples; i += 1) {
      samples[i + j * xSamples] = i * 10 + 2 * j * 10;
    }
  }

  return {
    xCells,
    yCells,
    cellSize: 10,
    min: [0, 0, 0],
    max: [xCells * 10, 0, yCells * 10],
    xSamples,
    ySamples,
    xSpacing: 10,
    ySpacing: 10,
    groupNames: new Uint32Array(8),
    tagNames: new Uint32Array(128),
    flags: Uint16Array.from(flags),
    regionTags: new Uint32Array(xCells * yCells),
    heights: Float32Array.from(flags, (_, cell) => cell * 4),
    samples,
  };
}

/** The segments of `positions` as pairs of `[x, y, z]` ends. */
function segmentsOf(positions: Float32Array): number[][][] {
  const segments: number[][][] = [];
  for (let at = 0; at < positions.length; at += 6) {
    segments.push([
      Array.from(positions.subarray(at, at + 3)),
      Array.from(positions.subarray(at + 3, at + 6)),
    ]);
  }
  return segments;
}

describe("navCellOutlines", () => {
  it("returns a segment on each edge between a cell with the bit and a cell without it", () => {
    const grid = gridOf(3, 2, [0, NAV_OUTLINE_BITS.brush, 0, 0, 0, 0]);

    expect(segmentsOf(navCellOutlines(grid, NAV_OUTLINE_BITS.brush))).toEqual([
      [
        [10, 10, 0],
        [10, 30, 10],
      ],
      [
        [20, 20, 0],
        [20, 40, 10],
      ],
      [
        [10, 30, 10],
        [20, 40, 10],
      ],
    ]);
  });

  it("returns no segment on the border of the grid", () => {
    const grid = gridOf(2, 1, [NAV_OUTLINE_BITS.brush, NAV_OUTLINE_BITS.brush]);

    expect(navCellOutlines(grid, NAV_OUTLINE_BITS.brush)).toHaveLength(0);
  });

  it("matches a cell whose word has the bit among others", () => {
    const transparentWall = 0x42;
    const grid = gridOf(2, 1, [transparentWall, NAV_OUTLINE_BITS.brush]);

    expect(segmentsOf(navCellOutlines(grid, NAV_OUTLINE_BITS.wall))).toEqual([
      [
        [10, 10, 0],
        [10, 30, 10],
      ],
    ]);
  });

  it("places an end at the mean cell height if the end is outside the samples", () => {
    const grid = gridOf(2, 1, [NAV_OUTLINE_BITS.wall, 0], false);

    expect(segmentsOf(navCellOutlines(grid, NAV_OUTLINE_BITS.wall))).toEqual([
      [
        [10, 2, 0],
        [10, 2, 10],
      ],
    ]);
  });
});
