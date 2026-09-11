import { describe, expect, it } from "vitest";

import { CAMERA } from "../cameraPresets";
import { framing, meshBounds, orthographicFraming, reachOfZoom, zoomOfReach } from "../framing";
import type { MeshGeometry } from "../meshBuffer";

/** A box two units across and two tall, standing on the ground at the origin. */
const BOX = { min: [-1, 0, -1], max: [1, 2, 1] } as const;

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A body of three vertices, and a weapon off to its side that the skin can hide. */
const ARMED: MeshGeometry = {
  positions: Float32Array.of(0, 0, 0, 2, 4, -1, -3, 1, 5, 100, 0, 0),
  normals: null,
  uvs: null,
  skinIndices: null,
  skinWeights: null,
  indices: Uint32Array.of(0, 1, 2, 3, 3, 3),
  ranges: [
    { name: "Body", startIndex: 0, indexCount: 3 },
    { name: "Weapon", startIndex: 3, indexCount: 3 },
  ],
};

describe("meshBounds", () => {
  it("spans every drawn vertex, across the mirrored axis and at the scale it is drawn", () => {
    expect(meshBounds(ARMED, ["weapon"], 2)).toEqual({ min: [-4, 0, -2], max: [6, 8, 10] });
  });

  it("reaches a submesh nothing hides", () => {
    expect(meshBounds(ARMED, [], 1)?.min[0]).toBe(-100);
  });

  it("is none for a mesh that draws no vertex", () => {
    expect(meshBounds(ARMED, ["Body", "Weapon"], 1)).toBeNull();
  });
});

describe("framing", () => {
  it("looks at the middle of the box", () => {
    expect(framing(BOX, 45, 1).target).toEqual([0, 1, 0]);
  });

  it("stands where the scene's camera opens from, far enough to hold the box", () => {
    const framed = framing(BOX, 45, 1);
    const radius = Math.hypot(2, 2, 2) / 2;
    const held = radius / Math.sin((45 * Math.PI) / 360);

    expect(distance(framed.position, framed.target)).toBeGreaterThan(held);

    const opening = [
      CAMERA.position[0] - CAMERA.target[0],
      CAMERA.position[1] - CAMERA.target[1],
      CAMERA.position[2] - CAMERA.target[2],
    ];
    const along = framed.position.map((value, axis) => value - framed.target[axis]);
    const cosine =
      (opening[0] * along[0] + opening[1] * along[1] + opening[2] * along[2]) /
      (Math.hypot(...opening) * Math.hypot(...along));
    expect(cosine).toBeCloseTo(1, 6);
  });

  it("stands further back in a pane narrower than it is tall", () => {
    const wide = framing(BOX, 45, 2);
    const narrow = framing(BOX, 45, 0.5);

    expect(distance(narrow.position, narrow.target)).toBeGreaterThan(
      distance(wide.position, wide.target),
    );
  });

  it("stands where the caller looks from, at whatever length they name it", () => {
    const framed = framing(BOX, 45, 1, [0, 4, 0]);

    expect(framed.position[0]).toBeCloseTo(0, 6);
    expect(framed.position[2]).toBeCloseTo(0, 6);
    expect(framed.position[1]).toBeGreaterThan(framed.target[1]);
  });
});

describe("orthographicFraming", () => {
  it("zooms the narrower side of the canvas onto the box", () => {
    const framed = orthographicFraming(BOX, 400, 200, [0, 1, 0]);
    const radius = Math.hypot(2, 2, 2) / 2;

    expect(framed.target).toEqual([0, 1, 0]);
    expect(framed.zoom * 2 * radius).toBeLessThan(200);
  });

  it("zooms out for the same box in a smaller pane", () => {
    expect(orthographicFraming(BOX, 200, 200).zoom).toBeLessThan(
      orthographicFraming(BOX, 800, 800).zoom,
    );
  });

  it("stands clear of the box it holds, along the direction it is given", () => {
    const framed = orthographicFraming(BOX, 400, 400, [0, 0, 1]);

    expect(framed.position[2]).toBeGreaterThan(BOX.max[2]);
    expect(framed.position[0]).toBeCloseTo(0, 6);
  });
});

describe("reachOfZoom and zoomOfReach", () => {
  it("stands a right-angle lens half the canvas's height back per pixel of zoom", () => {
    expect(reachOfZoom(2, 400, 90)).toBeCloseTo(100, 6);
    expect(zoomOfReach(100, 400, 90)).toBeCloseTo(2, 6);
  });

  it("round-trips through either projection", () => {
    expect(zoomOfReach(reachOfZoom(0.37, 713, 45), 713, 45)).toBeCloseTo(0.37, 9);
  });

  it("holds one unit per pixel where the canvas has no height", () => {
    expect(zoomOfReach(100, 0, 45)).toBe(1);
  });
});
