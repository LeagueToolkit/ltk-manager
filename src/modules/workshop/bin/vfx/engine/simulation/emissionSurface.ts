import type { Rng } from "../utils/Rng";

/** A birth position and its surface normal, in the emitter's own space. */
export interface SurfaceBirth {
  readonly position: Float32Array;
  readonly normal: Float32Array;
}

/** A loaded surface sampled at simulation time, including during seeks. */
export interface EmissionSampler {
  sample(time: number, rng: Rng, out: SurfaceBirth): boolean;
}

/** One system's samplers, by the index of the emitter that emits from each. */
export type SystemSurfaces = ReadonlyMap<number, EmissionSampler>;

/**
 * Every system's samplers, by the child path the system is drawn under, empty for the root.
 *
 * Keyed by path and index rather than by the emitter model, so a swap that installs new
 * emitter objects still finds the samplers already loaded.
 */
export type EmissionSurfaces = ReadonlyMap<string, SystemSurfaces>;

/** The two sets have the same sampler for every emitter. */
export function surfacesEquals(a: EmissionSurfaces, b: EmissionSurfaces): boolean {
  if (a.size !== b.size) return false;

  for (const [path, samplers] of a) {
    const other = b.get(path);
    if (other === undefined || other.size !== samplers.size) return false;

    for (const [index, sampler] of samplers) {
      if (other.get(index) !== sampler) return false;
    }
  }
  return true;
}
