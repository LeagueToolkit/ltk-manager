import { describe, expect, it } from "vitest";

import { PRIMITIVES } from "../primitives";
import { drawSketch, type SketchKind } from "../primitiveSketch";

const KINDS: readonly SketchKind[] = [
  "cameraQuad",
  "arbitraryQuad",
  "ray",
  "beam",
  "segmentBeam",
  "cameraTrail",
  "arbitraryTrail",
  "mesh",
  "attachedMesh",
  "projection",
  "none",
];

describe("the primitive sketch", () => {
  it("draws every kind at finite points from any angle", () => {
    for (const kind of KINDS) {
      for (const yaw of [0, 1.3, Math.PI, 5.1]) {
        const sketch = drawSketch(kind, yaw);
        const points = [
          ...sketch.shapes.flatMap((shape) => shape.points),
          ...sketch.dots,
          ...sketch.ground.flat(),
          ...sketch.guides.flat(),
        ];
        expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      }
    }
  });

  it("keeps a camera quad square to the view as the camera turns", () => {
    for (const yaw of [0.2, 2.4, 4.4]) {
      for (const { points } of drawSketch("cameraQuad", yaw).shapes) {
        const [topLeft, topRight, bottomRight, bottomLeft] = points;
        expect(topLeft![1]).toBeCloseTo(topRight![1], 1);
        expect(bottomLeft![1]).toBeCloseTo(bottomRight![1], 1);
        expect(topLeft![0]).toBeCloseTo(bottomLeft![0], 1);
      }
    }
  });

  it("stretches a beam between its two endpoints alone", () => {
    const sketch = drawSketch("beam", 0.6);

    expect(sketch.dots).toHaveLength(2);
    expect(sketch.shapes).toHaveLength(1);
  });

  it("draws the particles of a primitive that draws nothing, and no shape", () => {
    const sketch = drawSketch("none", 0.6);

    expect(sketch.shapes).toHaveLength(0);
    expect(sketch.dots.length).toBeGreaterThan(0);
  });

  it("lists the twelve concrete primitive classes once each", () => {
    const listed = PRIMITIVES.map((primitive) => primitive.name);

    expect(listed).toHaveLength(12);
    expect(new Set(PRIMITIVES.map((primitive) => primitive.hash)).size).toBe(12);
  });
});
