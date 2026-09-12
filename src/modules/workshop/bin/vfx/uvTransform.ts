/**
 * One particle's UV transform, as the numbers a layer's sampler reads.
 *
 * The formulas: a birth ramp the age climbs, clamped or wrapped on its own, then the
 * integrated scroll on top, and the rotation the same way in degrees. The angle and the
 * two scales reach the shader rather than the 2x3 matrix itself, because the shader is
 * what builds a basis out of them either way. A flip is the layer's own and lands after
 * the transform, in the sampler's hands.
 */

import { ADDRESS_MODE, type AddressMode } from "./enums";
import type { EmitterModel, UvLayer } from "./model";
import { type Pool, UV, uvAt } from "./pool";
import { sampleCurve } from "./sampleCurve";

/** What one layer hands its sampler for one particle. */
export interface UvDraw {
  /** The angle the cell turns through, in radians. */
  turn: number;
  /** The scale about the centre. */
  scaleU: number;
  scaleV: number;
  /** The whole scroll, in cells. */
  offsetU: number;
  offsetV: number;
  /** Where the particle's own cell starts, in texture space. */
  cellU: number;
  cellV: number;
}

/** Scratch a caller reuses, so a frame allocates nothing per particle. */
export function uvDraw(): UvDraw {
  return { turn: 0, scaleU: 1, scaleV: 1, offsetU: 0, offsetV: 0, cellU: 0, cellV: 0 };
}

/** How far `uvScrollClamp` lets the birth ramp run, in cells either way. */
const RAMP_REACH = 1;

const DEGREE = Math.PI / 180;

/**
 * One layer's transform for the particle at `index`, into `out`.
 *
 * `now` is the emitter's own clock rather than the particle's, because
 * `emitterUvScrollRate` is absolute time times rate with no accumulator behind it, and
 * `age` is the particle's, because its ramps and its book play on its own life.
 */
export function uvTransformInto(
  pool: Pool,
  index: number,
  layer: UvLayer,
  which: number,
  age: number,
  age01: number,
  now: number,
  out: UvDraw,
): void {
  const slot = uvAt(index, which);
  const scale = sampleCurve(layer.scale, age01);

  const turned =
    (sampleCurve(layer.rotation, age01)[0] ?? 0) +
    age * pool.uv[slot + UV.birthRotate] +
    pool.uv[slot + UV.rotate];
  out.turn = turned * DEGREE;
  out.scaleU = scale[0] ?? 1;
  out.scaleV = scale[1] ?? 1;

  const rampU = pool.uv[slot + UV.birthOffsetX] + age * pool.uv[slot + UV.birthScrollX];
  const rampV = pool.uv[slot + UV.birthOffsetY] + age * pool.uv[slot + UV.birthScrollY];
  out.offsetU = periodic(
    ramp(rampU, layer.scrollClamp) + pool.uv[slot + UV.scrollX] + layer.emitterScrollRate[0] * now,
    layer.addressMode,
  );
  out.offsetV = periodic(
    ramp(rampV, layer.scrollClamp) + pool.uv[slot + UV.scrollY] + layer.emitterScrollRate[1] * now,
    layer.addressMode,
  );

  const book = layer.book;
  const columns = Math.max(Math.round(book.divisions[0]), 1);
  const rows = Math.max(Math.round(book.divisions[1]), 1);
  const frames = Math.max(Math.round(book.frames), 1);

  /* The run wraps before `startFrame` is added, so it cycles from that frame onward
     rather than back to the grid's first cell. Past the grid the sampler wraps. */
  const played = wrap(pool.uv[slot + UV.phase] + age * pool.uv[slot + UV.frameRate], frames);
  const cell = wrap(Math.trunc(book.start + played), columns * rows);

  out.cellU = (cell % columns) / columns;
  out.cellV = Math.floor(cell / columns) / rows;
}

/** The birth ramp held within reach when the layer clamps, and wrapped into a cell otherwise. */
function ramp(value: number, clamped: boolean): number {
  if (clamped) return Math.min(Math.max(value, -RAMP_REACH), RAMP_REACH);
  return value - Math.floor(value);
}

/** `value` brought inside `[0, span)`, which a negative one still lands in. */
function wrap(value: number, span: number): number {
  return ((value % span) + span) % span;
}

/**
 * A scroll brought back by the period its address mode repeats over.
 *
 * `emitterUvScrollRate * now` grows without bound, and a float32 attribute in the
 * thousands has a resolution of a texel, so the fold the sampler would do is done here at
 * full precision. A clamp or a border keeps the raw scroll, which is what carries the
 * texture past its edge.
 */
function periodic(offset: number, mode: AddressMode): number {
  if (mode === ADDRESS_MODE.wrap) return wrap(offset, 1);
  if (mode === ADDRESS_MODE.mirror) return wrap(offset, 2);
  return offset;
}

/** The layer at `which`, and null where the emitter carries no second one. */
export function layerOf(emitter: EmitterModel, which: number): UvLayer | null {
  return which === 0 ? emitter.uv : emitter.multUv;
}

/** How wide and how tall one cell is, which is what the shader lands a wrapped uv in. */
export function cellSize(layer: UvLayer): [number, number] {
  return [
    1 / Math.max(Math.round(layer.book.divisions[0]), 1),
    1 / Math.max(Math.round(layer.book.divisions[1]), 1),
  ];
}
