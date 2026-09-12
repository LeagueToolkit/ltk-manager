import { describe, expect, it } from "vitest";

import { TRAIL_SMOOTHING } from "../enums";
import {
  type BeamEnds,
  type BeamParticle,
  commitRibbon,
  type Cursor,
  type RibbonArrays,
  ribbonBuffers,
  type RibbonLayer,
  type RibbonLayers,
  type Strand,
  strand,
  type TrailBuild,
  UV_STRIDE,
  writeBeam,
  writeTrail,
} from "../ribbon";

/** The transform that leaves a uv where it is, as a strand carries one per point. */
const PLAIN_UV = [0, 1, 1, 0, 0, 0, 0];

/** A layer turning about the cell's middle and mirroring nothing. */
const PLAIN_LAYER: RibbonLayer = { center: [0.5, 0.5], flipU: false, flipV: false };

/** That layer alone, for an emitter carrying no `textureMult`. */
const PLAIN_LAYERS: RibbonLayers = { base: PLAIN_LAYER, mult: null };

/** That layer under a second one of its own. */
const TWO_LAYERS: RibbonLayers = { base: PLAIN_LAYER, mult: PLAIN_LAYER };

/**
 * A strand along the engine's x, oldest first, one unit half-wide, white, its side
 * along z, with no tiling and no travel.
 */
function along(...xs: number[]): Strand {
  const held = strand(xs.length);
  held.count = xs.length;
  xs.forEach((x, at) => {
    held.position[at * 3] = x;
    held.width[at] = 1;
    held.color.fill(1, at * 4, at * 4 + 4);
    held.side.set([0, 0, 1], at * 3);
    held.uv.set(PLAIN_UV, at * UV_STRIDE);
  });
  return held;
}

function arrays(vertices: number): RibbonArrays {
  return {
    position: new Float32Array(vertices * 3),
    uv: new Float32Array(vertices * 2),
    alphaUv: new Float32Array(vertices * 2),
    cell: new Float32Array(vertices * 2),
    tint: new Float32Array(vertices * 4),
    lookup: new Float32Array(vertices * 2),
    erode: new Float32Array(vertices),
    multUv: new Float32Array(vertices * 2),
    multCell: new Float32Array(vertices * 2),
    index: new Uint32Array(Math.max(vertices - 2, 0) * 3),
    edges: new Uint32Array(Math.max(vertices - 2, 0) * 3 * 2),
  };
}

/** Looking down the engine's -z, which is across every strand `along` lays. */
const CAMERA: TrailBuild = {
  view: [0, 0, -1],
  wake: false,
  smoothing: TRAIL_SMOOTHING.off,
  cutoff: 0,
  layers: PLAIN_LAYERS,
};

/** Expanding along each point's own side. */
const ARBITRARY: TrailBuild = { ...CAMERA, view: null };

function cursor(): Cursor {
  return { vertex: 0, index: 0 };
}

/* A mirrored zero is a negative zero, which `toEqual` tells apart, so each is added to. */
function vertex(out: RibbonArrays, at: number): number[] {
  return Array.from(out.position.subarray(at * 3, at * 3 + 3), (value) => value + 0);
}

function uvs(out: RibbonArrays, vertices: number): number[] {
  return Array.from(out.uv.subarray(0, vertices * 2), (value) => value + 0);
}

function us(out: RibbonArrays, vertices: number): number[] {
  return uvs(out, vertices).filter((_, slot) => slot % 2 === 0);
}

describe("writeTrail", () => {
  it("runs the mult layer's own transform over the coordinate the base's takes", () => {
    const held = along(0, 10);
    held.multUv.set([0, 1, 1, 0.25, 0, 0.5, 0], 0);
    held.multUv.set([0, 1, 1, 0.25, 0, 0.5, 0], UV_STRIDE);
    const out = arrays(4);

    writeTrail(held, { ...ARBITRARY, layers: TWO_LAYERS }, out, cursor());

    expect(uvs(out, 4)).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
    expect(Array.from(out.multUv)).toEqual([0.25, 0, 0.25, 1, 0.25, 0, 0.25, 1]);
    expect(Array.from(out.multCell)).toEqual([0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0]);
  });

  it("writes no mult uv for an emitter carrying no second layer", () => {
    const held = along(0, 10);
    held.multUv.set([0, 1, 1, 0.25, 0, 0.5, 0], 0);
    const out = arrays(4);

    writeTrail(held, ARBITRARY, out, cursor());

    expect(Array.from(out.multUv)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("walks newest to oldest, two vertices a point, stitching each pair to the last", () => {
    const out = arrays(6);
    const at = cursor();

    writeTrail(along(0, 10, 20), CAMERA, out, at);

    expect(at).toEqual({ vertex: 6, index: 12 });
    expect(vertex(out, 0)[0]).toBe(-20);
    expect(vertex(out, 4)[0]).toBe(0);
    expect(Array.from(out.index)).toEqual([2, 0, 1, 2, 1, 3, 4, 2, 3, 4, 3, 5]);
  });

  it("expands a camera trail across the view and its tangent, mirrored into the viewport", () => {
    const out = arrays(4);
    writeTrail(along(0, 10), CAMERA, out, cursor());

    expect(vertex(out, 0)).toEqual([-10, 1, 0]);
    expect(vertex(out, 1)).toEqual([-10, -1, 0]);
    expect(vertex(out, 2)).toEqual([0, 1, 0]);
  });

  it("expands an arbitrary trail along each point's own side, whatever the tangent", () => {
    const held = along(0, 10);
    held.side.set([0, 1, 0], 0);
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(vertex(out, 0)).toEqual([-10, 0, 1]);
    expect(vertex(out, 2)).toEqual([0, 1, 0]);
    expect(vertex(out, 3)).toEqual([0, -1, 0]);
  });

  it("takes each point's own half-width", () => {
    const held = along(0, 10);
    held.width[0] = 4;
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(vertex(out, 3)).toEqual([0, 0, -4]);
  });

  it("runs u from the first of the walk in repeats of the birth tiling", () => {
    const held = along(0, 10, 30);
    for (let at = 0; at < 3; at += 1) held.tiling[at * 2] = 10;
    const out = arrays(6);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(uvs(out, 6)).toEqual([0, 0, 0, 1, 2, 0, 2, 1, 3, 0, 3, 1]);
  });

  it("puts u at zero everywhere under no tiling, rather than stretching one repeat", () => {
    const out = arrays(6);
    writeTrail(along(0, 10, 40), ARBITRARY, out, cursor());

    expect(us(out, 6)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("pins a wake's u to the odometer at birth, less the first point's even part", () => {
    const held = along(0, 10, 20);
    held.odometer.set([0, 250, 700]);
    for (let at = 0; at < 3; at += 1) held.tiling[at * 2] = 100;
    const out = arrays(6);
    writeTrail(held, { ...ARBITRARY, wake: true }, out, cursor());

    expect(us(out, 6)).toEqual([1, 1, -3.5, -3.5, -6, -6]);
  });

  it("spans v about the middle by the width over the tiling, or a literal span below zero", () => {
    const held = along(0, 10);
    held.tiling[1] = 4;
    held.tiling[3] = -0.5;
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(uvs(out, 4).filter((_, slot) => slot % 2 === 1)).toEqual([0.25, 0.75, 0.375, 0.625]);
  });

  it("runs a raw uv through the point's own transform and carries its cell", () => {
    const held = along(0, 10);
    held.uv.set([0, 2, 1, 0.25, 0, 0.5, 0.25], 0);
    held.uv.set([0, 2, 1, 0.25, 0, 0.5, 0.25], UV_STRIDE);
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(out.uv[0]).toBeCloseTo(-0.25, 6);
    expect(out.uv[1]).toBeCloseTo(0, 6);
    expect(Array.from(out.cell.subarray(0, 2))).toEqual([0.5, 0.25]);
  });

  it("carries each point's colour onto both of its vertices", () => {
    const held = along(0, 10);
    held.color.set([0.5, 0.25, 0, 1], 0);
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(Array.from(out.tint.subarray(8, 16))).toEqual([0.5, 0.25, 0, 1, 0.5, 0.25, 0, 1]);
  });

  it("carries each point's ramp lookup onto both of its vertices", () => {
    const held = along(0, 10);
    held.lookup.set([0.25, 0.75], 0);
    held.lookup.set([0.5, 0.125], 2);
    const out = arrays(4);
    writeTrail(held, ARBITRARY, out, cursor());

    expect(Array.from(out.lookup)).toEqual([0.5, 0.125, 0.5, 0.125, 0.25, 0.75, 0.25, 0.75]);
  });

  it("truncates the walk at the cutoff's length, and never the first point", () => {
    const out = arrays(6);
    const at = cursor();
    writeTrail(along(0, 10, 30), { ...ARBITRARY, cutoff: 15 }, out, at);

    expect(at).toEqual({ vertex: 2, index: 0 });

    const tiny = cursor();
    writeTrail(along(0, 10), { ...ARBITRARY, cutoff: 0.001 }, arrays(4), tiny);
    expect(tiny.vertex).toBe(2);
  });

  it("walks oldest to newest under BackToFront, so u opens on the tail", () => {
    const held = along(0, 10, 20);
    for (let at = 0; at < 3; at += 1) held.tiling[at * 2] = 10;
    const out = arrays(6);
    writeTrail(held, { ...ARBITRARY, smoothing: TRAIL_SMOOTHING.backToFront }, out, cursor());

    expect(vertex(out, 0)[0]).toBe(0);
    expect(out.uv[0]).toBe(0);
    expect(out.uv[4]).toBe(1);
  });

  it("box-filters an interior point over its neighbours when smoothing is on", () => {
    const held = along(0, 10, 20);
    held.position[4] = 10;
    const out = arrays(6);
    writeTrail(held, { ...ARBITRARY, smoothing: TRAIL_SMOOTHING.frontToBack }, out, cursor());

    expect(vertex(out, 0)).toEqual([-20, 0, 1]);
    expect(vertex(out, 2)[1]).toBeCloseTo(10 / 3, 5);
    expect(vertex(out, 4)).toEqual([0, 0, 1]);
  });

  it("miters each joint to the bisector of its side and the last", () => {
    const held = along(0, 10, 20);
    held.side.set([0, 1, 0], 6);
    const out = arrays(6);
    writeTrail(held, { ...ARBITRARY, smoothing: TRAIL_SMOOTHING.frontToBack }, out, cursor());

    const half = Math.SQRT1_2;
    expect(vertex(out, 2)[1]).toBeCloseTo(half, 6);
    expect(vertex(out, 2)[2]).toBeCloseTo(half, 6);
  });

  it("miters a joint against its own two sides rather than against the last miter", () => {
    const held = along(0, 10, 20, 30);
    held.side.set([0, 1, 0], 6);
    held.side.set([0, 1, 0], 9);
    const out = arrays(8);
    writeTrail(held, { ...ARBITRARY, smoothing: TRAIL_SMOOTHING.frontToBack }, out, cursor());

    /* The walk runs 3, 2, 1, 0, so the last joint has the same side either side of it and
       its bisector is that side. A running average of the three before it would not be. */
    expect(vertex(out, 6)[1]).toBeCloseTo(0, 6);
    expect(vertex(out, 6)[2]).toBeCloseTo(1, 6);
  });

  it("keeps a pair apart on a camera trail seen along its own length", () => {
    const out = arrays(6);
    writeTrail(along(0, 10, 20), { ...CAMERA, view: [1, 0, 0] }, out, cursor());

    expect(vertex(out, 0)[2] - vertex(out, 1)[2]).toBeCloseTo(2, 6);
    expect(vertex(out, 2)[2] - vertex(out, 3)[2]).toBeCloseTo(2, 6);
  });

  it("keeps a pair apart where two points land on each other", () => {
    const out = arrays(4);
    writeTrail(along(0, 0), CAMERA, out, cursor());

    expect(vertex(out, 0)).not.toEqual(vertex(out, 1));
  });

  it("writes nothing for a lone point", () => {
    const at = cursor();
    writeTrail(along(5), ARBITRARY, arrays(4), at);

    expect(at).toEqual({ vertex: 0, index: 0 });
  });

  it("appends past the cursor and advances it", () => {
    const out = arrays(8);
    const at = cursor();
    writeTrail(along(0, 10), ARBITRARY, out, at);
    writeTrail(along(50, 60), ARBITRARY, out, at);

    expect(at).toEqual({ vertex: 8, index: 12 });
    expect(Array.from(out.index.subarray(6, 12))).toEqual([6, 4, 5, 6, 5, 7]);
    expect(vertex(out, 4)[0]).toBe(-60);
  });

  it("refuses a strand the arrays cannot hold", () => {
    const at = cursor();
    writeTrail(along(0, 10, 20), ARBITRARY, arrays(4), at);

    expect(at).toEqual({ vertex: 0, index: 0 });
  });
});

/** A beam from the origin along the engine's x, seen from up its z. */
const ENDS: BeamEnds = { source: [0, 0, 0], target: [100, 0, 0], eye: [0, 0, 100] };

const IDENTITY = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

function particleOf(over: Partial<BeamParticle> = {}): BeamParticle {
  return {
    scale: new Float32Array([4, 0, 0]),
    color: new Float32Array([1, 1, 1, 1]),
    tiling: new Float32Array(2),
    tilingAt: 0,
    turn: IDENTITY,
    local: [0, 0, 0],
    uv: new Float32Array(PLAIN_UV),
    uvAt: 0,
    multUv: new Float32Array(PLAIN_UV),
    lookup: new Float32Array(2),
    erode: 1,
    ...over,
  };
}

describe("writeBeam", () => {
  it("writes one quad from the target end to the source end, across the view", () => {
    const out = arrays(4);
    const at = cursor();

    writeBeam(ENDS, particleOf(), PLAIN_LAYERS, out, at);

    expect(at).toEqual({ vertex: 4, index: 6 });
    expect(vertex(out, 0)).toEqual([-100, -2, 0]);
    expect(vertex(out, 1)).toEqual([-100, 2, 0]);
    expect(vertex(out, 2)).toEqual([0, 2, 0]);
    expect(vertex(out, 3)).toEqual([0, -2, 0]);
    expect(Array.from(out.index)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(uvs(out, 4)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it("trims each end by scale0's second and third shares", () => {
    const out = arrays(4);
    writeBeam(
      ENDS,
      particleOf({ scale: new Float32Array([4, 0.25, 0.25]) }),
      PLAIN_LAYERS,
      out,
      cursor(),
    );

    expect(vertex(out, 0)[0]).toBe(-75);
    expect(vertex(out, 2)[0]).toBe(-25);
  });

  it("keeps its width when the eye lies on the line through both ends", () => {
    const out = arrays(4);
    writeBeam(
      { source: [0, 0, 0], target: [100, 0, 0], eye: [-50, 0, 0] },
      particleOf(),
      PLAIN_LAYERS,
      out,
      cursor(),
    );

    expect(vertex(out, 0)).not.toEqual(vertex(out, 1));
  });

  it("lays an arbitrary beam across the world's up", () => {
    const out = arrays(4);
    writeBeam({ ...ENDS, eye: null }, particleOf(), PLAIN_LAYERS, out, cursor());

    expect(vertex(out, 0)).toEqual([-100, 0, -2]);
    expect(vertex(out, 1)).toEqual([-100, 0, 2]);
  });

  it("narrows an arbitrary beam toward vertical and lets the particle's position leak in", () => {
    const upright = arrays(4);
    writeBeam(
      { source: [0, 0, 0], target: [0, 100, 0], eye: null },
      particleOf(),
      PLAIN_LAYERS,
      upright,
      cursor(),
    );
    expect(vertex(upright, 0)).toEqual(vertex(upright, 1));

    const leaked = arrays(4);
    writeBeam(
      { ...ENDS, eye: null },
      particleOf({ local: [0, 5, 0] }),
      PLAIN_LAYERS,
      leaked,
      cursor(),
    );
    expect(vertex(leaked, 0)).toEqual([-100, -10, -2]);
  });

  it("spans the uv by the width and the length over the birth tiling", () => {
    const out = arrays(4);
    writeBeam(ENDS, particleOf({ tiling: new Float32Array([2, 50]) }), PLAIN_LAYERS, out, cursor());

    expect(uvs(out, 4)).toEqual([0, 0, 2, 0, 2, 2, 0, 2]);
  });

  it("scrolls u along the beam and v across it, the texture's v running along", () => {
    const out = arrays(4);
    const scrolled = particleOf({ uv: new Float32Array([0, 1, 1, 0.25, 0.5, 0, 0]) });

    writeBeam(ENDS, scrolled, PLAIN_LAYERS, out, cursor());

    expect(uvs(out, 4)).toEqual([0.5, 0.25, 1.5, 0.25, 1.5, 1.25, 0.5, 1.25]);
  });

  it("mirrors a flipped axis within the cell after the transform", () => {
    const out = arrays(4);
    const scrolled = particleOf({ uv: new Float32Array([0, 1, 1, 0.25, 0, 0, 0]) });

    writeBeam(ENDS, scrolled, { base: { ...PLAIN_LAYER, flipU: true }, mult: null }, out, cursor());

    expect(uvs(out, 4)).toEqual([0, 0.75, 1, 0.75, 1, -0.25, 0, -0.25]);
  });

  it("locks the alpha's uv against the scroll, keeping the scale", () => {
    const out = arrays(4);
    const scrolled = particleOf({ uv: new Float32Array([0, 2, 1, 0.25, 0.5, 0, 0]) });

    writeBeam(ENDS, scrolled, PLAIN_LAYERS, out, cursor());

    expect(Array.from(out.alphaUv)).toEqual([0, 0, 1, 0, 1, 2, 0, 2]);
  });

  it("carries the particle's colour onto every corner", () => {
    const out = arrays(4);
    writeBeam(
      ENDS,
      particleOf({ color: new Float32Array([0.5, 0, 0, 1]) }),
      PLAIN_LAYERS,
      out,
      cursor(),
    );

    expect(Array.from(out.tint.subarray(12, 16))).toEqual([0.5, 0, 0, 1]);
  });

  it("carries the particle's ramp lookup onto every corner", () => {
    const out = arrays(4);
    writeBeam(
      ENDS,
      particleOf({ lookup: new Float32Array([0.5, 0.125]) }),
      PLAIN_LAYERS,
      out,
      cursor(),
    );

    expect(Array.from(out.lookup)).toEqual([0.5, 0.125, 0.5, 0.125, 0.5, 0.125, 0.5, 0.125]);
  });

  it("runs the mult layer's own transform over each corner, transposed as the base's is", () => {
    const out = arrays(4);
    const scrolled = particleOf({ multUv: new Float32Array([0, 1, 1, 0.25, 0, 0, 0]) });

    writeBeam(ENDS, scrolled, TWO_LAYERS, out, cursor());

    expect(uvs(out, 4)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(Array.from(out.multUv)).toEqual([0, 0.25, 1, 0.25, 1, 1.25, 0, 1.25]);
  });

  it("refuses a quad the arrays cannot hold", () => {
    const at = cursor();
    writeBeam(ENDS, particleOf(), PLAIN_LAYERS, arrays(2), at);

    expect(at).toEqual({ vertex: 0, index: 0 });
  });
});

describe("commitRibbon", () => {
  it("uploads the written range of each attribute, and the index only where it changed", () => {
    const buffers = ribbonBuffers(8);
    buffers.arrays.index.set([0, 1, 2, 0, 2, 3]);

    commitRibbon(buffers, { vertex: 4, index: 6 });
    const version = buffers.index.version;
    expect(buffers.position.updateRanges).toEqual([{ start: 0, count: 12 }]);
    expect(buffers.tint.updateRanges).toEqual([{ start: 0, count: 16 }]);
    expect(buffers.index.updateRanges).toEqual([{ start: 0, count: 6 }]);
    expect(buffers.geometry.drawRange.count).toBe(6);

    commitRibbon(buffers, { vertex: 4, index: 6 });
    expect(buffers.index.version).toBe(version);

    buffers.arrays.index[4] = 3;
    commitRibbon(buffers, { vertex: 4, index: 6 });
    expect(buffers.index.version).toBe(version + 1);
  });

  it("builds the edge twin's index off the triangle index, once per changed commit", () => {
    const buffers = ribbonBuffers(8);
    buffers.arrays.index.set([0, 1, 2, 0, 2, 3]);

    commitRibbon(buffers, { vertex: 4, index: 6 });
    const version = buffers.edges.version;
    expect(Array.from(buffers.arrays.edges.subarray(0, 12))).toEqual([
      0, 1, 1, 2, 2, 0, 0, 2, 2, 3, 3, 0,
    ]);
    expect(buffers.edges.updateRanges).toEqual([{ start: 0, count: 12 }]);
    expect(buffers.edgeGeometry.drawRange.count).toBe(12);

    commitRibbon(buffers, { vertex: 4, index: 6 });
    expect(buffers.edges.version).toBe(version);
  });

  it("takes nothing up for a frame that wrote nothing", () => {
    const buffers = ribbonBuffers(8);
    const version = buffers.position.version;

    commitRibbon(buffers, { vertex: 0, index: 0 });

    expect(buffers.position.version).toBe(version);
    expect(buffers.geometry.drawRange.count).toBe(0);
  });
});
