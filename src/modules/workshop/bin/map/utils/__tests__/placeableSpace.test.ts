import { Matrix4 } from "three";
import { describe, expect, it } from "vitest";

import type { MapChunkItem } from "@/lib/tauri";

import type { PlacedItem } from "../mapOutline";
import { shapeLines } from "../placeableShapes";
import {
  axisText,
  engineTransform,
  movesOf,
  parseAxis,
  placeableMoves,
  shownDrag,
  transformOf,
  type TransformParts,
  transformParts,
  viewportMatrix,
} from "../placeableSpace";

function placed(key: string, transform: number[]): PlacedItem {
  const item: MapChunkItem = {
    key,
    name: key,
    class: "MapLocator",
    kind: "locator",
    position: [transform[12] ?? 0, transform[13] ?? 0, transform[14] ?? 0],
    transform: transform as MapChunkItem["transform"],
    shape: null,
    visibility: 255,
    controller: null,
  };
  return { id: `0x1/${key}`, chunk: { entry: "0x1", name: null, items: [item] }, item };
}

function translation(x: number, y: number, z: number): number[] {
  return new Matrix4().makeTranslation(x, y, z).toArray();
}

describe("viewportMatrix", () => {
  it("mirrors the engine's x axis and back", () => {
    const transform = translation(10, 20, 30);

    const viewport = viewportMatrix(transform);

    expect(viewport.elements.slice(12, 15)).toEqual([-10, 20, 30]);
    expect(engineTransform(viewport)).toEqual(transform);
  });
});

describe("movesOf", () => {
  it("moves every item by the lead's change", () => {
    const items = [placed("0xa", translation(0, 0, 0)), placed("0xb", translation(100, 0, 0))];
    const before = viewportMatrix(translation(0, 0, 0));
    const after = before.clone().premultiply(new Matrix4().makeTranslation(-5, 0, 0));

    const moves = movesOf(
      items.map(({ id, item }) => ({ id, transform: item.transform })),
      before,
      after,
    );

    expect(moves.map((move) => move.transform.slice(12, 15))).toEqual([
      [5, 0, 0],
      [105, 0, 0],
    ]);
  });
});

describe("transformParts", () => {
  it("splits a transform and joins it back", () => {
    const parts: TransformParts = {
      position: [10, 20, 30],
      rotation: [0, 90, 0],
      scale: [2, 2, 2],
    };

    const back = transformParts(transformOf(parts));

    expect(back.position.map((value) => Math.round(value))).toEqual([10, 20, 30]);
    expect(back.rotation.map((value) => Math.round(value))).toEqual([0, 90, 0]);
    expect(back.scale.map((value) => Math.round(value * 100) / 100)).toEqual([2, 2, 2]);
  });
});

describe("placeableMoves", () => {
  it("splits placeable ids into chunk and key and skips mesh ids", () => {
    const transform = translation(1, 2, 3);

    expect(
      placeableMoves([
        { id: "0x1/0xa", transform },
        { id: "mesh:4", transform },
      ]),
    ).toEqual([{ chunk: "0x1", key: "0xa", transform }]);
  });
});

describe("shownDrag", () => {
  const outline = [{ entry: "0x1" }];
  const transforms = new Map([["0x1/0xa", translation(5, 0, 0)]]);
  const held = { transforms, basis: { outline, geometryRevision: 2 } };

  it("shows a drag over the reads it started on", () => {
    expect(shownDrag(held, { outline, geometryRevision: 2 })).toBe(transforms);
    expect(shownDrag(null, { outline, geometryRevision: 2 })).toBeNull();
  });

  it("drops a drag once a placeable edit or its undo changes the outline", () => {
    expect(shownDrag(held, { outline: [{ entry: "0x1" }], geometryRevision: 2 })).toBeNull();
  });

  it("drops a drag once a mesh edit or its undo changes the geometry revision", () => {
    expect(shownDrag(held, { outline, geometryRevision: 3 })).toBeNull();
    expect(shownDrag(held, { outline, geometryRevision: null })).toBeNull();
  });
});

describe("shapeLines", () => {
  it("draws a box as twelve edges", () => {
    const lines = shapeLines([
      { shape: { type: "box", min: [0, 0, 0], max: [1, 1, 1] }, transform: translation(0, 0, 0) },
    ]);

    expect(lines.length).toBe(12 * 2 * 3);
  });

  it("draws a perspective frustum with lines to its apex", () => {
    const lines = shapeLines([
      {
        shape: {
          type: "frustum",
          fov: 60,
          aspect: 1,
          near: 10,
          far: 500,
          orthographic: false,
          orthoHeight: 200,
        },
        transform: translation(0, 0, 0),
      },
    ]);

    expect(lines.length).toBe(16 * 2 * 3);
  });
});

describe("axisText", () => {
  it("rounds to three fraction digits", () => {
    expect(axisText(89.99999999)).toBe("90");
    expect(axisText(1.23456)).toBe("1.235");
    expect(axisText(-12.5)).toBe("-12.5");
  });

  it("reads a negative zero as 0", () => {
    expect(axisText(-0)).toBe("0");
    expect(axisText(-0.0001)).toBe("0");
  });
});

describe("parseAxis", () => {
  it("reads a typed number", () => {
    expect(parseAxis(" 12.5 ")).toBe(12.5);
    expect(parseAxis("-3")).toBe(-3);
  });

  it("returns null if the text is not a finite number", () => {
    expect(parseAxis("")).toBeNull();
    expect(parseAxis("abc")).toBeNull();
    expect(parseAxis("Infinity")).toBeNull();
  });
});
