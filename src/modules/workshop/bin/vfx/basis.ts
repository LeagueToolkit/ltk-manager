/**
 * The basis a particle stands on, off its euler degrees, which every draw path builds.
 *
 * The product is `Ry * Rx * Rz`. The engine's world matrix holds the same three vectors
 * as its rows: row 0 is the particle's local `+X` and row 2 its local `+Z`. A basis here
 * is the transpose of that, a row-major 3x3 whose columns are the local axes, so
 * `world = basis * local` and a product composes right to left.
 */

/* The numbers alone rather than the module barrel: the barrel pulls the renderer and
   ThreeJS with it, and the simulation is drawn in the shell's own chunk (ADR-0037). */
// eslint-disable-next-line no-restricted-imports -- the chunk the comment above names
import { AXIS_SIGN } from "@/modules/viewport/space";

import type { Point } from "./rig";

const DEGREE = Math.PI / 180;

/** Which axis of a basis a caller reads, as the column it is in. */
export const AXIS = { x: 0, y: 1, z: 2 } as const;

/**
 * The row-major 3x3 the euler degrees at `at` in `degrees` stand at, into `out`.
 *
 * The engine composes `Rz . Rx . Ry` over its own row vectors, which is `Ry . Rx . Rz`
 * over the columns a basis here holds. Pitch turns about `X`, yaw about `Y` and roll
 * about `Z`. Every draw
 * path reads the one matrix this builds, so a quad's rows and a mesh's whole basis stand
 * on the same composition.
 *
 * `roll` is added to the third angle, which is where a simple emitter's own `rotation`
 * lands.
 */
export function standingInto(
  degrees: Float32Array,
  at: number,
  roll: number,
  out: Float32Array,
): Float32Array {
  const cx = Math.cos(degrees[at] * DEGREE);
  const sx = Math.sin(degrees[at] * DEGREE);
  const cy = Math.cos(degrees[at + 1] * DEGREE);
  const sy = Math.sin(degrees[at + 1] * DEGREE);
  const cz = Math.cos((degrees[at + 2] + roll) * DEGREE);
  const sz = Math.sin((degrees[at + 2] + roll) * DEGREE);

  out[0] = cy * cz + sy * sx * sz;
  out[1] = -cy * sz + sy * sx * cz;
  out[2] = sy * cx;
  out[3] = cx * sz;
  out[4] = cx * cz;
  out[5] = -sx;
  out[6] = -sy * cz + cy * sx * sz;
  out[7] = sy * sz + cy * sx * cz;
  out[8] = cy * cx;
  return out;
}

/**
 * The row-major 3x3 whose local `+Z` lies along `direction`, into `out`.
 *
 * `isDirectionOriented` on the complex mesh path: local `+X` is the world's up crossed
 * into the direction and local `+Y` closes the frame, so a mesh aims its `+Z` where it
 * travels. The identity for a direction with no length, and the world's `+X` stands in
 * for a degenerate cross.
 */
export function alongInto(direction: Float32Array, at: number, out: Float32Array): Float32Array {
  const length = Math.hypot(direction[at], direction[at + 1], direction[at + 2]);
  if (length === 0) return identityInto(out);

  const zx = direction[at] / length;
  const zy = direction[at + 1] / length;
  const zz = direction[at + 2] / length;

  /* The world's up crossed into the direction, and its own `+X` where the two are one. */
  let xx = zz;
  const xy = 0;
  let xz = -zx;
  const across = Math.hypot(xx, xy, xz);
  if (across < DEGENERATE) {
    xx = 1;
    xz = 0;
  } else {
    xx /= across;
    xz /= across;
  }

  out[0] = xx;
  out[1] = zy * xz - zz * xy;
  out[2] = zx;
  out[3] = xy;
  out[4] = zz * xx - zx * xz;
  out[5] = zy;
  out[6] = xz;
  out[7] = zx * xy - zy * xx;
  out[8] = zz;
  return out;
}

/** How near the world's up a direction comes before its cross stops being a direction. */
const DEGENERATE = 1e-5;

/** The unit vector a basis sends `axis` to, written to `out` from `at`. */
export function axisInto(basis: Float32Array, axis: number, out: Float32Array, at: number): void {
  out[at] = basis[axis];
  out[at + 1] = basis[3 + axis];
  out[at + 2] = basis[6 + axis];
}

/** The identity, into `out`. */
export function identityInto(out: Float32Array): Float32Array {
  out.set(IDENTITY);
  return out;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** `out = a * b`, with `a` read from `at`, safe for `out` being either operand. */
export function multiplyInto(a: Float32Array, b: Float32Array, out: Float32Array, at = 0): void {
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      PRODUCT[row * 3 + column] =
        a[at + row * 3] * b[column] +
        a[at + row * 3 + 1] * b[3 + column] +
        a[at + row * 3 + 2] * b[6 + column];
    }
  }
  out.set(PRODUCT);
}

const PRODUCT = new Float32Array(9);

/** The three numbers at `at` in `vector`, turned in place by the basis at `from` in `turn`. */
export function turnInto(turn: Float32Array, vector: Float32Array, at: number, from = 0): void {
  const x = vector[at];
  const y = vector[at + 1];
  const z = vector[at + 2];
  vector[at] = turn[from] * x + turn[from + 1] * y + turn[from + 2] * z;
  vector[at + 1] = turn[from + 3] * x + turn[from + 4] * y + turn[from + 5] * z;
  vector[at + 2] = turn[from + 6] * x + turn[from + 7] * y + turn[from + 8] * z;
}

/**
 * The basis a system stands at facing `direction`, into `out`.
 *
 * A yaw alone, the engine's own look-at: the local `+Z` is the direction laid flat and
 * the up stays the world's. The identity for a direction with no reach in the ground
 * plane.
 */
export function yawInto(direction: Point, out: Float32Array): Float32Array {
  const length = Math.hypot(direction[0], direction[2]);
  if (length === 0) return identityInto(out);

  const x = direction[0] / length;
  const z = direction[2] / length;
  out.set([z, 0, x, 0, 1, 0, -x, 0, z]);
  return out;
}

/**
 * The basis a missile flies on, into `out`: local `Y` along `direction` laid flat, local
 * `X` to its right and local `Z` down.
 *
 * A missile-attached system takes the game object's own matrix rather than one the VFX
 * code builds, so the rig stands in for that object and has to carry its convention.
 * Shipped missiles author their travel
 * on `Y`: `Ezreal_Base_BA_crit_mis` gives `arcane_noodles` no rotation at all and
 * `birthVelocity (50, -200, 0)` with `birthScale0 (20, 70, 1)`, a quad 70 long on the
 * axis it streams back along. A direction with no reach in the plane flies forward.
 */
export function flightInto(direction: Point, out: Float32Array): Float32Array {
  const length = Math.hypot(direction[0], direction[2]);
  const x = length === 0 ? 0 : direction[0] / length;
  const z = length === 0 ? 1 : direction[2] / length;
  out.set([z, x, 0, 0, 0, -1, -x, z, 0]);
  return out;
}

/**
 * The basis at `at` in `basis` as the viewport sees it, into `out` from `to`.
 *
 * A change of basis by one mirrored axis conjugates a rotation, so a cell whose row or
 * column is that axis, and not both, changes sign.
 */
export function mirrorInto(basis: Float32Array, at: number, out: Float32Array, to: number): void {
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[to + row * 3 + column] =
        basis[at + row * 3 + column] * AXIS_SIGN[row] * AXIS_SIGN[column];
    }
  }
}

/**
 * The basis at `at` in `basis` with unit columns, into `out` from `to`, and each column's
 * own length into `scale`.
 *
 * A spawn frame carries `scaleOverride` and the system transform's scale in its columns,
 * where a quaternion reads a turn off an unscaled basis alone and a `Matrix4.compose`
 * takes the scale beside the turn rather than inside it. A column of no length keeps the
 * identity's, because a basis that flattens an axis has no direction to read off it.
 *
 * `out` may be `basis` at the same offset.
 */
export function unscaleInto(
  basis: Float32Array,
  at: number,
  out: Float32Array,
  to: number,
  scale: Float32Array,
): void {
  for (let column = 0; column < 3; column += 1) {
    const length = Math.hypot(basis[at + column], basis[at + 3 + column], basis[at + 6 + column]);
    const flat = length === 0;
    scale[column] = flat ? 1 : length;
    for (let row = 0; row < 3; row += 1) {
      const cell = row * 3 + column;
      out[to + cell] = flat ? IDENTITY[cell] : basis[at + cell] / length;
    }
  }
}
