/**
 * Where one newborn lands about its emitter, and the turn its birth vectors take.
 *
 * Each shape's two engine entry points: one samples the offset, and one builds the turn
 * that is then applied to the offset and the birth velocity alike. The draw ranges: a
 * size is a half-extent drawn either way, except a cylinder's height, which runs up from
 * the emitter. Every distribution is the engine's own naive one, so a volume sphere piles
 * up at its centre and a shell at its poles, and neither is corrected.
 */

import { identityInto, multiplyInto, turnInto } from "./basis";
import type { SpawnShape } from "./model";
import type { Point } from "./rig";
import type { Rng } from "./Rng";
import { drawCurve } from "./sampleCurve";

/** One birth's placement, into a caller's own scratch. */
export interface Birth {
  /** Where the particle lands, off the emitter, already turned. */
  readonly offset: Float32Array;
  /** The turn, a row-major 3x3, which `turned` says is anything but the identity. */
  readonly turn: Float32Array;
  turned: boolean;
}

/** Scratch a caller reuses, so a spawn allocates nothing per particle. */
export function birth(): Birth {
  return { offset: new Float32Array(3), turn: identityInto(new Float32Array(9)), turned: false };
}

const DEGREE = Math.PI / 180;
const QUARTER = Math.PI / 2;
const FULL = Math.PI * 2;

const X: Point = [1, 0, 0];
const Y: Point = [0, 1, 0];
const Z: Point = [0, 0, 1];

/**
 * The offset and the turn one shape draws for one particle, in the shape's own order.
 *
 * `chance` is the particle's one birth draw, which a legacy shape's tables are read at.
 */
export function sampleShape(
  shape: SpawnShape,
  rng: Rng,
  t01: number,
  chance: number,
  out: Birth,
): void {
  identityInto(out.turn);
  out.turned = false;

  switch (shape.kind) {
    case "point":
      out.offset.set(shape.offset);
      return;

    case "legacy": {
      const offset = drawCurve(shape.offset, t01, chance);
      const moved = drawCurve(shape.translation, t01, chance);
      for (let axis = 0; axis < 3; axis += 1) {
        out.offset[axis] = (offset[axis] ?? 0) + (moved[axis] ?? 0);
      }
      const turns = Math.min(shape.angles.length, shape.axes.length);
      for (let each = 0; each < turns; each += 1) {
        const degrees = drawCurve(shape.angles[each], t01, chance)[0] ?? 0;
        spin(out, shape.axes[each], degrees * DEGREE);
      }
      break;
    }

    case "box": {
      out.offset[0] = rng.range(-1, 1) * shape.size[0];
      out.offset[1] = rng.range(-1, 1) * shape.size[1];
      out.offset[2] = (shape.volume ? rng.range(-1, 1) : 1) * shape.size[2];
      if (!shape.volume) {
        /* A face at +Z, sent to one of the four sides by quarter turns. */
        spin(out, Y, Math.floor(rng.unitFloat() * 4) * QUARTER);
        spin(out, Z, Math.floor(rng.unitFloat() * 2) * QUARTER);
      }
      break;
    }

    case "cylinder": {
      out.offset[0] = (shape.volume ? rng.range(-1, 1) : 1) * shape.radius;
      out.offset[1] = rng.unitFloat() * shape.height;
      out.offset[2] = 0;
      spin(out, Y, rng.unitFloat() * FULL);
      break;
    }

    case "sphere": {
      out.offset[0] = (shape.volume ? rng.unitFloat() : 1) * shape.radius;
      out.offset[1] = 0;
      out.offset[2] = 0;
      spin(out, Y, rng.unitFloat() * FULL);
      spin(out, Z, rng.unitFloat() * FULL);
      break;
    }
  }

  if (out.turned) turnInto(out.turn, out.offset, 0);
}

/** One more turn about `axis` composed onto the birth's, on its right. */
function spin(out: Birth, axis: Point, radians: number): void {
  if (radians === 0) return;
  axisAngle(axis, radians, SPUN);
  multiplyInto(out.turn, SPUN, out.turn);
  out.turned = true;
}

const SPUN = new Float32Array(9);

/** Rodrigues' rotation of `radians` about `axis`, into `out`, and the identity for no axis. */
function axisAngle(axis: Point, radians: number, out: Float32Array): void {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  if (length === 0) {
    identityInto(out);
    return;
  }
  const [x, y, z] = [axis[0] / length, axis[1] / length, axis[2] / length];
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;

  out[0] = t * x * x + c;
  out[1] = t * x * y - s * z;
  out[2] = t * x * z + s * y;
  out[3] = t * x * y + s * z;
  out[4] = t * y * y + c;
  out[5] = t * y * z - s * x;
  out[6] = t * x * z - s * y;
  out[7] = t * y * z + s * x;
  out[8] = t * z * z + c;
}

/** The world's three axes, which the box and the sphere turn about. */
export const AXES = { x: X, y: Y, z: Z } as const;
