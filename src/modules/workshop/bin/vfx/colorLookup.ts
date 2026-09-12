/**
 * Where one particle reads the colour ramp, `particleColorTexture`, in texture space.
 *
 * `colorLookUpTypeX` and `Y` each pick what drives an axis and `colorLookUpScales` and
 * `colorLookUpOffsets` place it, a `CONSTANT` axis reading the scale alone. The palette
 * is a different system, built from uniforms in `palette.ts`, and never sees the pair.
 */

import { COLOR_LOOKUP, type ColorLookup } from "./enums";
import type { EmitterModel } from "./model";
import type { Pool } from "./pool";

/** The particle at `index`'s lookup, into `out` from `at`. */
export function colorLookupInto(
  emitter: EmitterModel,
  pool: Pool,
  index: number,
  age01: number,
  out: Float32Array,
  at: number,
): void {
  out[at] = axis(
    emitter.lookupX,
    emitter.lookupScales[0],
    emitter.lookupOffsets[0],
    pool,
    index,
    age01,
  );
  out[at + 1] = axis(
    emitter.lookupY,
    emitter.lookupScales[1],
    emitter.lookupOffsets[1],
    pool,
    index,
    age01,
  );
}

/**
 * One axis of the lookup: what its kind reads off the particle, placed by the scale and
 * the offset.
 *
 * `VELOCITY` is how fast the particle actually travelled over the last step, in engine
 * units a second and divided by nothing, so the scale is the only normaliser. It reads
 * the pool's own travel rather than the stored velocity plus the emitter's drift, because
 * the integrator turns that drift by the particle's birth frame and drags it, and neither
 * is undone at draw time. `BIRTH_RANDOM` is the draw the sprite's start frame is also
 * taken from.
 */
function axis(
  kind: ColorLookup,
  scale: number,
  offset: number,
  pool: Pool,
  index: number,
  age01: number,
): number {
  switch (kind) {
    case COLOR_LOOKUP.lifetime:
      return scale * age01 + offset;
    case COLOR_LOOKUP.velocity:
      return (
        scale *
          Math.hypot(
            pool.travel[index * 3],
            pool.travel[index * 3 + 1],
            pool.travel[index * 3 + 2],
          ) +
        offset
      );
    case COLOR_LOOKUP.birthRandom:
      return scale * pool.roll[index] + offset;
    default:
      return scale;
  }
}
