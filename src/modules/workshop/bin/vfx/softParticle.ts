import { drawsFixedAlphaUv, drawsTheAttachment } from "./drawKind";
import { BLEND_MODE, type BlendMode } from "./enums";
import type { EmitterModel, SoftModel } from "./model";

/** Four lanes of a shader constant, in the order the shader reads them. */
type Lanes = readonly [number, number, number, number];

/** Where an in-fade of no width starts, far enough behind any scene that every gap is past it. */
const NO_FADE_IN = -1e9;

/**
 * The soft fade an emitter's draw path runs, and null where its shader compiles none.
 *
 * `skinnedmesh/particle_ps` carries no `SOFT_PARTICLES`, and a quad under `LOCK_ALPHA`
 * draws through `quad_ps_fixedalphauv`, which carries none either. A ribbon shares the
 * quad's batch, so it follows the quad. Decision 2.43 of docs/plans/vfx-particle-renderer.md.
 */
export function fadeOf(emitter: EmitterModel): SoftModel | null {
  if (emitter.soft === null || drawsTheAttachment(emitter) || drawsFixedAlphaUv(emitter)) {
    return null;
  }
  return emitter.soft;
}

/** The emitter's draw path runs a soft fade, which needs the scene's depth pass. */
export function fades(emitter: EmitterModel): boolean {
  return fadeOf(emitter) !== null;
}

/**
 * `cSoftParticleParams`: where the fade in and the fade out start, then the rate of each.
 *
 * Decision 2.43 of docs/plans/vfx-particle-renderer.md.
 */
export function softParams(soft: SoftModel): Lanes {
  const fadesIn = soft.deltaIn !== 0;
  return [
    fadesIn ? soft.beginIn : NO_FADE_IN,
    soft.beginIn + soft.deltaIn + soft.beginOut,
    fadesIn ? 1 / soft.deltaIn : 1,
    soft.deltaOut === 0 ? 0 : 1 / soft.deltaOut,
  ];
}

/** `cSoftParticleControl`, as `rgb * (x + fade * y)` and `a * (z + fade * w)` read it. */
const FADES = {
  alpha: [1, 0, 0, 1],
  both: [0, 1, 0, 1],
  colour: [0, 1, 1, 0],
} as const satisfies Record<string, Lanes>;

/**
 * `cSoftParticleControl` under `mode`: the fade reaches what the blend weighs the colour by.
 *
 * Decision 2.43 of docs/plans/vfx-particle-renderer.md.
 */
export function softControl(mode: BlendMode): Lanes {
  if (mode === BLEND_MODE.alpha || mode === BLEND_MODE.alphaAdd) return FADES.alpha;
  if (mode === BLEND_MODE.premultipliedAlpha) return FADES.both;
  return FADES.colour;
}
