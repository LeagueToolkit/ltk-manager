import { describe, expect, it } from "vitest";

import type { NavGrid } from "../navGridBuffer";
import {
  type NavGridColorConfig,
  type NavRegionGroup,
  type NavTerrainTag,
  regionTagOf,
  type Rgba,
  terrainTagOf,
  writeCellColors,
} from "../navGridColors";

const ERROR: Rgba = [0, 0, 255, 255];

/** The terrain tags of Map11, in file order, each colored by its position in the list. */
const MAP11_TAGS: NavTerrainTag[] = (
  [
    ["none", 0],
    ["WALL", 2],
    ["TRANSPARENT_WALL", 66],
    ["GRASS", 1],
    ["EXPOSED", 256],
    ["TRANSIENT", 4],
    ["OPAQUE_WALL", 514],
    ["ONLY_PASSABLE_BY_TEAM_ORDER", 1088],
    ["ONLY_PASSABLE_BY_TEAM_CHAOS", 2112],
    ["GRASS_ONLY_PASSABLE_BY_TEAM_ORDER", 1025],
    ["GRASS_ONLY_PASSABLE_BY_TEAM_CHAOS", 2049],
    ["ONLY_PASSABLE_BY_TEAM_ORDER_NEUTRAL_ZONE_VISIBILITY", 5184],
    ["ONLY_PASSABLE_BY_TEAM_CHAOS_NEUTRAL_ZONE_VISIBILITY", 6208],
    ["GRASS_WALL", 3],
  ] satisfies [string, number][]
).map(([name, flags], index) => ({ name, flags, color: [index, 0, 0, 255] }));

/**
 * Returns a 2 x 1 grid with the cell words of the `ltk_navgrid` test grid. Group `g` is named
 * `g + 1` and its tag `t` is named `g * 100 + t`.
 */
function grid(): NavGrid {
  return {
    xCells: 2,
    yCells: 1,
    cellSize: 50,
    min: [0, 0, 0],
    max: [100, 0, 50],
    xSamples: 3,
    ySamples: 2,
    xSpacing: 50,
    ySpacing: 50,
    groupNames: Uint32Array.from({ length: 8 }, (_, group) => group + 1),
    tagNames: Uint32Array.from({ length: 128 }, (_, at) => Math.floor(at / 16) * 100 + (at % 16)),
    flags: Uint16Array.of(0x0442, 0x8001),
    regionTags: Uint32Array.of(0x87654321, 0x87654322),
    heights: Float32Array.of(1.5, 1.5),
    samples: Float32Array.of(0, 1, 2, 3, 4, 5),
  };
}

/** The `Music` group of the grid: group 0, whose cells hold tag indices 1 and 2. */
const MUSIC: NavRegionGroup = {
  name: "Music",
  nameHash: 1,
  gameplay: false,
  tags: [{ name: "Tag2", nameHash: 2, color: [9, 9, 9, 255] }],
};

function config(terrainTags: NavTerrainTag[]): NavGridColorConfig {
  return { terrainTags, regionGroups: [MUSIC], errorColor: ERROR };
}

function texels(colors: Uint8Array): number[][] {
  return Array.from({ length: colors.length / 4 }, (_, cell) =>
    Array.from(colors.subarray(cell * 4, cell * 4 + 4)),
  );
}

describe("terrainTagOf", () => {
  it("returns the tag with the most bits among the tags that match", () => {
    expect(terrainTagOf(MAP11_TAGS, 0x0082)?.name).toBe("WALL");
  });

  it("returns the earlier tag if two matching tags have the same bit count", () => {
    expect(terrainTagOf(MAP11_TAGS, 0x0442)?.name).toBe("TRANSPARENT_WALL");
  });

  it("returns null if no tag matches", () => {
    expect(terrainTagOf([{ name: "WALL", flags: 2, color: [0, 0, 0, 255] }], 0x0001)).toBeNull();
  });
});

describe("regionTagOf", () => {
  it("returns the config tag whose name hash equals the grid tag of the cell", () => {
    expect(regionTagOf(grid(), MUSIC, 1)?.name).toBe("Tag2");
  });

  it("returns null if the grid tag has no config tag", () => {
    expect(regionTagOf(grid(), MUSIC, 0)).toBeNull();
  });

  it("returns null if the grid has no group of the config group's name", () => {
    expect(regionTagOf(grid(), { ...MUSIC, nameHash: 99 }, 1)).toBeNull();
  });
});

describe("writeCellColors", () => {
  it("writes the terrain color of each cell with the given alpha", () => {
    const colors = new Uint8Array(8);
    writeCellColors(grid(), config(MAP11_TAGS), { kind: "terrain" }, 128, colors);

    expect(texels(colors)).toEqual([
      [2, 0, 0, 128],
      [3, 0, 0, 128],
    ]);
  });

  it("writes the error color if no terrain tag matches", () => {
    const colors = new Uint8Array(8);
    writeCellColors(grid(), config(MAP11_TAGS.slice(1, 2)), { kind: "terrain" }, 255, colors);

    expect(texels(colors)).toEqual([[1, 0, 0, 255], ERROR]);
  });

  it("writes the region tag color of each cell and the error color if the grid tag has no config tag", () => {
    const colors = new Uint8Array(8);
    writeCellColors(grid(), config(MAP11_TAGS), { kind: "region", group: MUSIC }, 255, colors);

    expect(texels(colors)).toEqual([ERROR, [9, 9, 9, 255]]);
  });

  it("writes the error color if the grid has no group of the config group's name", () => {
    const colors = new Uint8Array(8);
    const group = { ...MUSIC, nameHash: 99 };
    writeCellColors(grid(), config(MAP11_TAGS), { kind: "region", group }, 255, colors);

    expect(texels(colors)).toEqual([ERROR, ERROR]);
  });

  it("throws if the array does not hold 4 bytes per cell", () => {
    expect(() =>
      writeCellColors(grid(), config(MAP11_TAGS), { kind: "terrain" }, 255, new Uint8Array(4)),
    ).toThrow(RangeError);
  });
});
