import { NoColorSpace, NoToneMapping, SRGBColorSpace, type ToneMapping } from "three";

/**
 * The colour the viewport takes the engine's world to be.
 *
 * "Before T0" in docs/plans/vfx-particle-renderer.md names six values every tier rests
 * on. Each is read in exactly one place, so a reference screenshot corrects a constant
 * here rather than a decision spread over the renderer. The four plain numbers are in
 * `space.ts`, which a module that never draws reads without ThreeJS.
 */

export { AXIS_SIGN, CHAMPION_HEIGHT, FORWARD, UNITS_PER_METRE } from "./space";

/** The stage's textures are authored in sRGB, which is what the sampler decodes them from. */
export const TEXTURE_COLOR_SPACE = SRGBColorSpace;

/**
 * A particle's textures are sampled raw and blended in the space they are authored in.
 *
 * The engine's particle shaders neither decode a texel nor encode a fragment, so the
 * whole pass, the mult layer, the erosion map and the blend into the target, runs on the
 * authored bytes. A decoded texel lands every mid-tone a power darker than the game.
 */
export const PARTICLE_COLOR_SPACE = NoColorSpace;

/** The canvas is sRGB, and no tone map sits between the blend and it. */
export const OUTPUT_COLOR_SPACE = SRGBColorSpace;
export const TONE_MAPPING: ToneMapping = NoToneMapping;
