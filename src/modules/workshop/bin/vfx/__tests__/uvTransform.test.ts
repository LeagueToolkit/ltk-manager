import { describe, expect, it } from "vitest";

import { ADDRESS_MODE } from "../enums";
import { plainUvLayer, type UvLayer, type ValueCurve } from "../model";
import { createPool, type Pool, spawn, UV, uvAt } from "../pool";
import { cellSize, uvDraw, uvTransformInto } from "../uvTransform";

function flat(...constant: number[]): ValueCurve {
  return { constant, keys: [], tables: [] };
}

function layerOf(over: Partial<UvLayer> = {}, book: Partial<UvLayer["book"]> = {}): UvLayer {
  const plain = plainUvLayer();
  return { ...plain, ...over, book: { ...plain.book, ...book } };
}

/** A pool holding one particle born at zero, living a second. */
function onePool(): Pool {
  const pool = createPool(4);
  spawn(pool, 0, 0, 1, 0.5);
  return pool;
}

describe("uvTransformInto", () => {
  it("leaves a layer with no transform on the whole texture", () => {
    const out = uvDraw();
    uvTransformInto(onePool(), 0, plainUvLayer(), 0, 0, 0, 0, out);

    expect(out).toEqual({
      turn: 0,
      scaleU: 1,
      scaleV: 1,
      offsetU: 0,
      offsetV: 0,
      cellU: 0,
      cellV: 0,
    });
  });

  it("adds the emitter's own scroll off the clock rather than the particle's age", () => {
    const out = uvDraw();
    const layer = layerOf({ emitterScrollRate: [0.25, -0.5], addressMode: ADDRESS_MODE.clamp });

    uvTransformInto(onePool(), 0, layer, 0, 0, 0, 4, out);

    expect(out.offsetU).toBe(1);
    expect(out.offsetV).toBe(-2);
  });

  it("folds a long scroll by the period its address mode repeats over", () => {
    const out = uvDraw();
    const wrapped = layerOf({ emitterScrollRate: [1, -1], addressMode: ADDRESS_MODE.wrap });
    const mirrored = layerOf({ emitterScrollRate: [1, -1], addressMode: ADDRESS_MODE.mirror });

    uvTransformInto(onePool(), 0, wrapped, 0, 0, 0, 1000.25, out);
    expect(out.offsetU).toBeCloseTo(0.25, 6);
    expect(out.offsetV).toBeCloseTo(0.75, 6);

    uvTransformInto(onePool(), 0, mirrored, 0, 0, 0, 1000.25, out);
    expect(out.offsetU).toBeCloseTo(0.25, 6);
    expect(out.offsetV).toBeCloseTo(1.75, 6);
  });

  it("adds whatever the integrator has accumulated into the scroll and the turn", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.scrollX] = 0.125;
    pool.uv[uvAt(0, 0) + UV.rotate] = 60;

    const out = uvDraw();
    uvTransformInto(pool, 0, layerOf({ rotation: flat(30) }), 0, 0, 0, 0, out);

    expect(out.offsetU).toBe(0.125);
    expect(out.turn).toBeCloseTo(Math.PI / 2, 6);
  });

  it("climbs the birth ramp over the age and wraps it into a cell", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.birthOffsetX] = 0.5;
    pool.uv[uvAt(0, 0) + UV.birthScrollX] = 2;
    pool.uv[uvAt(0, 0) + UV.birthRotate] = 45;
    pool.uv[uvAt(0, 0) + UV.scrollX] = 3;

    const out = uvDraw();
    uvTransformInto(pool, 0, layerOf({ addressMode: ADDRESS_MODE.clamp }), 0, 1, 1, 0, out);

    /* The ramp of 2.5 wraps to 0.5 on its own, and the integrated 3 lands on top. */
    expect(out.offsetU).toBeCloseTo(3.5, 6);
    expect(out.turn).toBeCloseTo(Math.PI / 4, 6);
  });

  it("holds the ramp at one cell out under uvScrollClamp and leaves the rest alone", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.birthOffsetX] = 0.5;
    pool.uv[uvAt(0, 0) + UV.birthScrollX] = 2;
    pool.uv[uvAt(0, 0) + UV.birthScrollY] = -4;
    pool.uv[uvAt(0, 0) + UV.scrollX] = 3;

    const out = uvDraw();
    const layer = layerOf({ scrollClamp: true, addressMode: ADDRESS_MODE.clamp });
    uvTransformInto(pool, 0, layer, 0, 1, 1, 0, out);

    expect(out.offsetU).toBeCloseTo(4, 6);
    expect(out.offsetV).toBeCloseTo(-1, 6);
  });

  it("walks a phase onto its own cell of the grid", () => {
    const pool = onePool();
    const book = { divisions: [4, 2] as const, frames: 8 };

    const out = uvDraw();
    for (const [phase, u, v] of [
      [0, 0, 0],
      [1, 0.25, 0],
      [3.9, 0.75, 0],
      [4, 0, 0.5],
      [7, 0.75, 0.5],
    ]) {
      pool.uv[uvAt(0, 0) + UV.phase] = phase;
      uvTransformInto(pool, 0, layerOf({}, book), 0, 0, 0, 0, out);
      expect([out.cellU, out.cellV]).toEqual([u, v]);
    }
  });

  it("wraps a phase past the end of the book back to its start", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.phase] = 9;

    const out = uvDraw();
    uvTransformInto(pool, 0, layerOf({}, { divisions: [4, 2], frames: 8 }), 0, 0, 0, 0, out);

    expect([out.cellU, out.cellV]).toEqual([0.25, 0]);
  });

  it("runs from startFrame and wraps back to it rather than to the grid's first cell", () => {
    const pool = onePool();
    const book = { divisions: [8, 1] as const, frames: 4, start: 3 };

    const out = uvDraw();
    pool.uv[uvAt(0, 0) + UV.phase] = 0;
    uvTransformInto(pool, 0, layerOf({}, book), 0, 0, 0, 0, out);
    expect(out.cellU).toBe(3 / 8);

    pool.uv[uvAt(0, 0) + UV.phase] = 5;
    uvTransformInto(pool, 0, layerOf({}, book), 0, 0, 0, 0, out);
    expect(out.cellU).toBe(4 / 8);
  });

  it("wraps a frame past the grid around the atlas, as the sampler would", () => {
    const pool = onePool();
    const book = { divisions: [2, 2] as const, frames: 8, start: 3 };

    const out = uvDraw();
    pool.uv[uvAt(0, 0) + UV.phase] = 2;
    uvTransformInto(pool, 0, layerOf({}, book), 0, 0, 0, 0, out);

    expect([out.cellU, out.cellV]).toEqual([0.5, 0]);
  });

  it("advances the book over the particle's own age at its own rate", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.frameRate] = 10;

    const out = uvDraw();
    const book = { divisions: [4, 1] as const, frames: 4 };

    uvTransformInto(pool, 0, layerOf({}, book), 0, 0.25, 0.25, 0, out);
    expect(out.cellU).toBe(0.5);

    uvTransformInto(pool, 0, layerOf({}, book), 0, 0.35, 0.35, 0, out);
    expect(out.cellU).toBe(0.75);
  });

  it("reads the second layer's own slots rather than the first's", () => {
    const pool = onePool();
    pool.uv[uvAt(0, 0) + UV.scrollX] = 5;
    pool.uv[uvAt(0, 1) + UV.scrollX] = 9;

    const out = uvDraw();
    uvTransformInto(pool, 0, layerOf({ addressMode: ADDRESS_MODE.clamp }), 1, 0, 0, 0, out);

    expect(out.offsetU).toBe(9);
  });
});

describe("cellSize", () => {
  it("is the reciprocal of the grid the texture is cut into", () => {
    expect(cellSize(layerOf({}, { divisions: [4, 2] }))).toEqual([0.25, 0.5]);
  });

  it("is the whole texture for a layer that names no grid", () => {
    expect(cellSize(plainUvLayer())).toEqual([1, 1]);
  });

  it("refuses to divide by a grid of nothing", () => {
    expect(cellSize(layerOf({}, { divisions: [0, 0] }))).toEqual([1, 1]);
  });
});
