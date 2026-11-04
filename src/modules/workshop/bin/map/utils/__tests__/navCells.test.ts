import { describe, expect, it } from "vitest";

import type { NavGrid, NavGridColorConfig, NavGridOverlay } from "@/modules/viewport";

import {
  describeNavCell,
  navCellId,
  navCellOf,
  overlaysChanging,
  pickNavCell,
  snapToNavCell,
} from "../navCells";

/**
 * Returns a grid of 2 x 2 cells, 50 units each, from the origin, with 3 x 3 samples `spacing`
 * apart at height `height`. Group 0 is named 1, and its tag `t` is named `100 + t`.
 */
function grid(spacing = 50, height = 10): NavGrid {
  return {
    xCells: 2,
    yCells: 2,
    cellSize: 50,
    min: [0, 0, 0],
    max: [100, 0, 100],
    xSamples: 3,
    ySamples: 3,
    xSpacing: spacing,
    ySpacing: spacing,
    groupNames: Uint32Array.of(1, 0, 0, 0, 0, 0, 0, 0),
    tagNames: Uint32Array.from({ length: 128 }, (_, at) => (at < 16 ? 100 + at : 0)),
    flags: Uint16Array.of(0x0082, 0, 0, 0),
    regionTags: Uint32Array.of(0x1, 0x2, 0, 0),
    heights: Float32Array.of(11, 12, 13, 14),
    samples: new Float32Array(9).fill(height),
  };
}

describe("navCellOf", () => {
  it("reads back the cell of navCellId", () => {
    expect(navCellOf(navCellId(3, 17))).toEqual([3, 17]);
  });

  it("returns null for a mesh id, a placeable id or a malformed cell id", () => {
    expect(navCellOf("mesh:3")).toBeNull();
    expect(navCellOf("0xaaaaaaaa/0x00000001")).toBeNull();
    expect(navCellOf("navcell:1")).toBeNull();
    expect(navCellOf("navcell:1,-2")).toBeNull();
    expect(navCellOf("navcell:1.5,2")).toBeNull();
  });
});

describe("pickNavCell", () => {
  it("returns the cell under the point where the click meets the map", () => {
    expect(pickNavCell(grid(), [60, 12, 90], null)).toEqual([1, 1]);
  });

  it("returns null outside the cells", () => {
    expect(pickNavCell(grid(), [-1, 10, 10], null)).toBeNull();
    expect(pickNavCell(grid(), [100, 10, 10], null)).toBeNull();
  });

  it("returns null if the point is more than the cutoff above the sampled height", () => {
    expect(pickNavCell(grid(), [25, 160, 25], 150)).toEqual([0, 0]);
    expect(pickNavCell(grid(), [25, 161, 25], 150)).toBeNull();
    expect(pickNavCell(grid(), [25, 161, 25], null)).toEqual([0, 0]);
  });

  it("applies no cutoff outside the height samples", () => {
    /* The samples span 80 units of the 100 that the cells span, as on Summoner's Rift. */
    expect(pickNavCell(grid(40), [90, 500, 90], 150)).toEqual([1, 1]);
  });
});

describe("snapToNavCell", () => {
  it("moves a position to its cell center at the cell height", () => {
    expect(snapToNavCell(grid(), [60, 500, 90])).toEqual([75, 14, 75]);
  });

  it("returns null outside the cells", () => {
    expect(snapToNavCell(grid(), [-1, 0, 10])).toBeNull();
  });
});

describe("overlaysChanging", () => {
  const flags: NavGridOverlay = {
    kind: "flags",
    rects: [{ x: 0, y: 0, width: 2, height: 1, values: Uint16Array.of(0x0082, 2) }],
  };
  const regions: NavGridOverlay = {
    kind: "regions",
    rects: [{ x: 1, y: 0, width: 1, height: 1, values: Uint32Array.of(7) }],
  };

  it("lists the overlays that write a value other than the one the cell holds, in order", () => {
    const overlays = [
      { index: 2, files: [flags] },
      { index: 5, files: [regions] },
    ];

    expect(overlaysChanging(grid(), overlays, 1)).toEqual([2, 5]);
    expect(overlaysChanging(grid(), overlays, 0)).toEqual([]);
  });

  it("skips an overlay that writes the value an earlier overlay wrote", () => {
    const overlays = [
      { index: 0, files: [flags] },
      { index: 1, files: [flags] },
    ];

    expect(overlaysChanging(grid(), overlays, 1)).toEqual([0]);
  });
});

describe("describeNavCell", () => {
  const config: NavGridColorConfig = {
    terrainTags: [
      { name: "none", flags: 0, color: [0, 255, 0, 255] },
      { name: "WALL", flags: 2, color: [0, 0, 0, 255] },
    ],
    regionGroups: [
      {
        name: "Music",
        nameHash: 1,
        gameplay: false,
        tags: [{ name: "Base", nameHash: 101, color: [1, 2, 3, 255] }],
      },
    ],
    errorColor: [0, 0, 255, 255],
  };

  it("reports the terrain tag, the bits that no tag has and the tag of each group", () => {
    const report = describeNavCell(grid(), config, 0, 0);

    expect(report?.center).toEqual([25, 11, 25]);
    expect(report?.terrain?.name).toBe("WALL");
    expect(report?.untagged).toBe(0x80);
    expect(report?.regions.map(({ tag }) => tag?.name ?? null)).toEqual(["Base"]);
  });

  it("reports no region tag if the cell's grid tag has no config tag", () => {
    const report = describeNavCell(grid(), config, 1, 0);

    expect(report?.regions.map(({ tag }) => tag)).toEqual([null]);
  });

  it("returns null outside the cells", () => {
    expect(describeNavCell(grid(), config, 2, 0)).toBeNull();
  });
});
