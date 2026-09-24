/**
 * How a viewport smooths its edges once the frame is drawn.
 *
 * The game draws without multisampling and offers only FXAA, as `[Performance] EnableFXAA`.
 * SMAA is the 1x MEDIUM preset the game ships shaders for but never runs.
 */
export type AntiAliasing = "off" | "fxaa" | "smaa";

export const ANTI_ALIASING_MODES: readonly AntiAliasing[] = ["off", "fxaa", "smaa"];

/** The game's own default, `EnableFXAA=1`. */
export const DEFAULT_ANTI_ALIASING: AntiAliasing = "fxaa";

/**
 * The game's `fxaaQualityOptions` at the quality it draws with: the subpixel amount, the
 * edge threshold and the edge threshold floor.
 */
export const FXAA_QUALITY_OPTIONS = { subpix: 0.75, edgeThreshold: 0.5, edgeThresholdMin: 0.0833 };
