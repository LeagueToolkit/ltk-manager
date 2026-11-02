import { describe, expect, it } from "vitest";

import { localVertex, placeRegion, regionLines, regionOf, regionWalls } from "../regionShapes";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/* Moved to (10, 0, 20) and twice as tall. */
const PLACED = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 10, 0, 20, 1];
const SQUARE: [number, number, number][] = [
  [-1, 0, -1],
  [1, 0, -1],
  [1, 0, 1],
  [-1, 0, 1],
];

describe("placeRegion", () => {
  it("places each vertex under the transform, mirrored on X, and lifts the walls along its own Y", () => {
    const placed = placeRegion(SQUARE, 100, PLACED);

    expect(placed.base.map((point) => [point.x, point.y, point.z])).toEqual([
      [-9, 0, 19],
      [-11, 0, 19],
      [-11, 0, 21],
      [-9, 0, 21],
    ]);
    expect(placed.lift.toArray()).toEqual([0, 200, 0]);
  });

  it("lifts nothing for a flat polygon", () => {
    expect(placeRegion(SQUARE, 0, IDENTITY).lift.lengthSq()).toBe(0);
  });
});

describe("regionLines", () => {
  it("draws the base, the top and an edge up from each vertex", () => {
    expect(regionLines(placeRegion(SQUARE, 100, IDENTITY)).length).toBe(4 * 3 * 2 * 3);
  });

  it("draws the base alone for a flat polygon", () => {
    expect(regionLines(placeRegion(SQUARE, 0, IDENTITY)).length).toBe(4 * 2 * 3);
    expect(regionWalls(placeRegion(SQUARE, 0, IDENTITY))).toEqual([]);
  });
});

describe("regionWalls", () => {
  it("draws two triangles per edge", () => {
    expect(regionWalls(placeRegion(SQUARE, 100, IDENTITY)).length).toBe(4 * 2 * 3 * 3);
  });
});

describe("regionOf", () => {
  it("reads a region boundary with its colors, and a polygon as flat", () => {
    const region = regionOf(
      {
        type: "region",
        points: SQUARE,
        height: 50,
        lineColor: [1, 2, 3, 4],
        fillColor: [5, 6, 7, 8],
      },
      IDENTITY,
    );
    expect(region?.region?.lineColor).toEqual([1, 2, 3, 4]);
    expect(region?.placed.lift.toArray()).toEqual([0, 50, 0]);

    const polygon = regionOf({ type: "polygon", points: SQUARE }, IDENTITY);
    expect(polygon?.region).toBeNull();
    expect(polygon?.placed.lift.lengthSq()).toBe(0);
    expect(regionOf({ type: "sphere", radius: 1 }, IDENTITY)).toBeNull();
  });
});

describe("localVertex", () => {
  it("takes a placed vertex back to the region's own space", () => {
    const placed = placeRegion(SQUARE, 0, PLACED);

    expect(localVertex(placed.base[2]!, PLACED).map(Math.round)).toEqual([1, 0, 1]);
  });
});
