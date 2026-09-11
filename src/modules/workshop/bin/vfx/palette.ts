/**
 * What one emitter's palette hands its sampler: the row, and the two animation offsets.
 *
 * Both are uniforms, one value per emitter per frame, so a palette cannot vary per
 * particle. The `u` a texel reads at is the shader's, its channels under
 * `palleteSrcMixColor`.
 */

import type { EmitterModel, PaletteModel } from "./model";
import { frameOf, type Source } from "./particleRead";
import { sampleCurve } from "./sampleCurve";

/** The palette draws: it names a texture and cuts it into at least one row. */
export function drawsPalette(palette: PaletteModel | null): palette is PaletteModel {
  return palette !== null && palette.count > 0;
}

/**
 * The `v` the palette's row centre sits at, in texture space.
 *
 * `paletteSelector` is sampled at zero and its first channel is the row, which the half
 * texel centres and `paletteCount` divides. Nothing floors it, so a fractional selector
 * lands between rows.
 */
export function paletteRow(palette: PaletteModel): number {
  const picked = sampleCurve(palette.selector, 0)[0] ?? 0;
  return (picked + 0.5) / palette.count;
}

/** The two animation curves at the emitter's `phase`, added to `u` and `v`, into `out`. */
export function paletteScrollInto(palette: PaletteModel, phase: number, out: number[]): void {
  out[0] = sampleCurve(palette.scrollU, phase)[0] ?? 0;
  out[1] = sampleCurve(palette.scrollV, phase)[0] ?? 0;
}

/**
 * The scroll of `emitter`'s palette at its first source's phase, into `out`.
 *
 * The scroll is a uniform, one per emitter, so every child of one definition takes the
 * first one's phase. An emitter drawing no palette, or no source, leaves `out` alone.
 */
export function sourcesScrollInto(
  emitter: EmitterModel,
  sources: readonly Source[],
  out: number[],
): void {
  const first = sources.at(0);
  if (emitter.palette === null || first === undefined) return;
  paletteScrollInto(emitter.palette, frameOf(first, emitter).phase, out);
}
