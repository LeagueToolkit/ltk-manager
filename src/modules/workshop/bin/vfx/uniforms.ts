import type { Texture } from "three";

import type { FragmentTests } from "./blend";
import { drawsFixedAlphaUv } from "./drawKind";
import { type BlendMode, UV_MODE, type UvMode } from "./enums";
import { DEPTH_RANGE, FRAME, SCENE_DEPTH, VIEWPORT } from "./frame";
import type {
  DistortionModel,
  EmitterModel,
  ErosionModel,
  PaletteModel,
  ReflectionModel,
  SoftModel,
  UvLayer,
} from "./model";
import { drawsPalette, paletteRow } from "./palette";
import { fresnelLanes, reflectionLanes, reflectionTint } from "./reflection";
import { sampleCurve } from "./sampleCurve";
import { fadeOf, softControl, softParams } from "./softParticle";
import type { EmitterSamplers } from "./useVfxTextures";
import { cellSize } from "./uvTransform";

/** `depthBiasFactors`, the slope and the constant a polygon offset takes. */
export type DepthBias = readonly [number, number];

/** How an emitter asks to sit in front of or behind what it overlaps. */
export interface DepthOffset {
  readonly bias: DepthBias;
  /** `DepthPushPull`, engine units along the ray from the eye, a negative push toward it. */
  readonly pushPull: number;
}

/**
 * The pair asks for an offset, which the material builder every complex emitter shares
 * applies only where it is non-zero.
 */
export function offsets(bias: DepthBias): boolean {
  return bias[0] !== 0 || bias[1] !== 0;
}

/** The polygon offset `bias` asks for, and none for a zero pair. */
export function polygonOffsetOf(bias: DepthBias) {
  return {
    polygonOffset: offsets(bias),
    polygonOffsetFactor: bias[0],
    polygonOffsetUnits: bias[1],
  };
}

/**
 * The offset an attached mesh authoring none takes, holding it in front of its character.
 *
 * The census's modal authored pair, decision 2.37 of docs/plans/vfx-particle-renderer.md.
 */
export const OVERLAY: DepthBias = [-1, -1];

/** The two texture layers one emitter samples, and the second one's own texture. */
export interface QuadLayers {
  readonly base: UvLayer;
  /** `textureMult`, and null for an emitter carrying no second layer. */
  readonly mult: UvLayer | null;
  readonly multTexture: Texture | null;
  /** `uvMode`, of which `default` and `lockAlpha` draw and the rest draw as `default`. */
  readonly mode: UvMode;
  /** `particleColorTexture`, and null for an emitter carrying no ramp. */
  readonly colorTexture: Texture | null;
  /** `paletteDefinition` and its texture, and null for an emitter drawing no palette. */
  readonly palette: PaletteModel | null;
  readonly paletteTexture: Texture | null;
  /** `alphaErosionDefinition` and its map, and null for an emitter eroding nothing. */
  readonly erosion: ErosionModel | null;
  readonly erosionTexture: Texture | null;
  /** `distortionDefinition` and its normal map, and null for an emitter drawing colour. */
  readonly distortion: DistortionModel | null;
  readonly normalTexture: Texture | null;
  /** `reflectionDefinition` and its cube map, which the mesh materials alone read. */
  readonly reflection: ReflectionModel | null;
  readonly reflectionTexture: Texture | null;
  /** `softParticleParams` where the draw path fades, from `fadeOf`, and null elsewhere. */
  readonly soft: SoftModel | null;
}

/** Which of the emitter's optional passes this draw path compiles. */
export interface LayerDraws {
  /** The colour ramp, which a mesh reads per emitter in the engine and so leaves off. */
  readonly ramp: boolean;
  /** The rim and the reflection, which the mesh materials alone compile. */
  readonly sheen: boolean;
  /** The soft fade, which `skinnedmesh/particle_ps` alone compiles none of. */
  readonly fade: boolean;
}

/** The `QuadLayers` one emitter draws with, off its definition and the samplers that arrived. */
export function layersOf(
  emitter: EmitterModel,
  samplers: EmitterSamplers,
  draws: LayerDraws,
): QuadLayers {
  return {
    base: emitter.uv,
    mult: emitter.multUv,
    multTexture: samplers.mult,
    mode: emitter.uvMode,
    colorTexture: draws.ramp ? samplers.color : null,
    palette: emitter.palette,
    paletteTexture: samplers.palette,
    erosion: drawsFixedAlphaUv(emitter) ? null : emitter.erosion,
    erosionTexture: samplers.erosion,
    distortion: emitter.distortion,
    normalTexture: samplers.normal,
    reflection: draws.sheen ? emitter.reflection : null,
    reflectionTexture: draws.sheen ? samplers.reflection : null,
    soft: draws.fade ? fadeOf(emitter) : null,
  };
}

/** Which of a layer's axes are mirrored, as the shader's `mix` weights. */
function flips(layer: UvLayer): [number, number] {
  return [layer.flipU ? 1 : 0, layer.flipV ? 1 : 0];
}

/** A material's `#define` table, three's own key it compiles a shader permutation on. */
export type Defines = Readonly<Record<string, string | number>>;

/** Where `LOCK_ALPHA` samples the alpha, as the fragment pass's `lockAlpha` reads it. */
export const ALPHA_LOCK = { none: 0, corner: 1, unscrolled: 2 } as const;

/** The emitter carries a second layer and its texture has arrived. */
export function multiplies(layers: QuadLayers): boolean {
  return layers.mult !== null && layers.multTexture !== null;
}

/** The palette and the colour ramp's own uniforms: the two textures, the mix and the row. */
export function colorUniforms(layers: QuadLayers) {
  const palette =
    layers.paletteTexture !== null && drawsPalette(layers.palette) ? layers.palette : null;
  const mix = palette === null ? [0, 0, 0, 0] : [...sampleCurve(palette.mix, 0)];

  return {
    mapRamp: { value: layers.colorTexture },
    mapPalette: { value: layers.paletteTexture },
    addressPalette: { value: palette?.addressMode ?? 0 },
    paletteMix: { value: [mix[0] ?? 0, mix[1] ?? 0, mix[2] ?? 0, mix[3] ?? 0] },
    paletteRow: { value: palette === null ? 0 : paletteRow(palette) },
    paletteScroll: { value: [0, 0] },
  };
}

/**
 * The defines of the palette and the colour ramp, which every material shares.
 *
 * An erosion drops the ramp, and so does a mult layer under `LOCK_ALPHA`, whose bundle is
 * the one `MULT_PASS` drops it in. Anywhere else a mult layer moves the ramp onto its own
 * uv, the two sharing one lane. The definition decides both, whether or not the mult
 * texture has arrived.
 */
export function colorDefines(layers: QuadLayers): Defines {
  const palette =
    layers.paletteTexture !== null && drawsPalette(layers.palette) ? layers.palette : null;
  const multPass = layers.mult !== null;
  const ramp =
    layers.colorTexture !== null &&
    layers.erosion === null &&
    !(multPass && layers.mode === UV_MODE.lockAlpha);

  return {
    ...(ramp ? { HAS_RAMP: "" } : {}),
    ...(multPass ? { RAMP_AT_MULT: "" } : {}),
    ...(palette !== null ? { HAS_PALETTE: "" } : {}),
  };
}

/**
 * Which alpha carries the rim and the reflection, and none for a shader compiling neither.
 *
 * `mesh_ps` carries both by the drawn alpha, and `skinnedmesh/particle_ps` by the texel's
 * own, before the particle's colour. Decision 2.42 of docs/plans/vfx-particle-renderer.md.
 */
export const SHEEN = { none: 0, drawn: 1, texel: 2 } as const;

type Sheen = (typeof SHEEN)[keyof typeof SHEEN];

/** The rim and the reflection's own uniforms: the fresnel and reflection lanes, and the cube map. */
export function sheenUniforms(reflection: ReflectionModel | null, cube: Texture | null) {
  return {
    fresnel: { value: [...fresnelLanes(reflection)] },
    reflection: { value: [...reflectionLanes(reflection)] },
    reflectionTint: { value: [...reflectionTint(reflection)] },
    mapReflection: { value: cube },
  };
}

/**
 * The defines of the rim and the reflection.
 *
 * `REFLECTIVE` is a permutation of its own, so an emitter naming no cube map, or one whose
 * map has not arrived, draws the rim alone.
 */
export function sheenDefines(
  reflection: ReflectionModel | null,
  cube: Texture | null,
  sheen: Sheen,
): Defines {
  return {
    SHEEN: sheen,
    ...(reflection !== null && reflection.map !== null && cube !== null ? { REFLECTS: "" } : {}),
  };
}

/**
 * The uniforms of the soft fade, which measures its gap to `SCENE_DEPTH`.
 *
 * A material that fades nothing binds no depth, so a draw landing in the depth pass cannot
 * sample the target it writes.
 */
export function softUniforms(mode: BlendMode, soft: SoftModel | null) {
  return {
    softParams: { value: soft === null ? [0, 0, 0, 0] : [...softParams(soft)] },
    softControl: { value: [...softControl(mode)] },
    sceneDepth: { value: soft === null ? null : SCENE_DEPTH },
    depthRange: { value: DEPTH_RANGE },
  };
}

/** The defines of the soft fade, on the same condition as `softUniforms`. */
export function softDefines(soft: SoftModel | null): Defines {
  return soft !== null ? { SOFT: "" } : {};
}

/**
 * The uniforms of the fragment pass a quad and a mesh share: the two layers, the ramp,
 * the palette and the erosion.
 */
export function layerUniforms(texture: Texture | null, layers: QuadLayers, tests: FragmentTests) {
  const base = layers.base;
  const mult = layers.mult;

  return {
    map: { value: texture },
    alphaRef: { value: tests.alphaRef },
    cell: { value: cellSize(base) },
    center: { value: [base.center[0], base.center[1]] },
    flip: { value: flips(base) },
    address: { value: base.addressMode },
    mapMult: { value: layers.multTexture },
    cellMult: { value: mult === null ? [1, 1] : cellSize(mult) },
    centerMult: { value: mult === null ? [0.5, 0.5] : [mult.center[0], mult.center[1]] },
    flipMult: { value: mult === null ? [0, 0] : flips(mult) },
    addressMult: { value: mult?.addressMode ?? 0 },
    ...colorUniforms(layers),
    ...erosionUniforms(layers.erosion, layers.erosionTexture),
    ...distortionUniforms(layers.distortion, layers.normalTexture),
    ...sheenUniforms(null, null),
  };
}

/**
 * The defines of the fragment pass a quad and a mesh share: the two layers, the ramp,
 * the palette and the erosion.
 */
export function layerDefines(texture: Texture | null, layers: QuadLayers): Defines {
  return {
    ...(texture !== null ? { HAS_MAP: "" } : {}),
    ...(multiplies(layers) ? { HAS_MAP_MULT: "" } : {}),
    LOCK_ALPHA: layers.mode === UV_MODE.lockAlpha ? ALPHA_LOCK.corner : ALPHA_LOCK.none,
    ...colorDefines(layers),
    ...erosionDefines(layers.erosion, layers.erosionTexture),
    ...distortionDefines(layers.distortion, layers.normalTexture),
    ...sheenDefines(null, null, SHEEN.none),
  };
}

/** The uniforms a distortion shares across the three materials, off its definition. */
export function distortionUniforms(distortion: DistortionModel | null, texture: Texture | null) {
  return {
    warp: { value: distortion?.strength ?? 0 },
    mapNormal: { value: texture },
    frame: { value: FRAME },
    viewport: { value: VIEWPORT },
  };
}

/** The defines a distortion shares across the three materials, off its definition. */
export function distortionDefines(
  distortion: DistortionModel | null,
  texture: Texture | null,
): Defines {
  return {
    ...(distortion !== null ? { DISTORTS: "" } : {}),
    ...(distortion !== null && texture !== null ? { HAS_NORMAL: "" } : {}),
  };
}

/** The narrowest feather a rate is taken over, so an authored zero is a hard edge. */
const LEAST_FEATHER = 1e-4;

/**
 * What slot 9 holds where no map is bound.
 *
 * An emitter naming no map takes the engine's own 1x1 opaque white, the neutral factor.
 * A map named and not loaded takes a 1x1 transparent black instead, which erodes the
 * whole particle away under the default mixer.
 */
const WHITE = [1, 1, 1, 1];
const NOTHING = [0, 0, 0, 0];

/** The uniforms an erosion shares across the three materials, off its definition. */
export function erosionUniforms(erosion: ErosionModel | null, texture: Texture | null) {
  const mix = erosion === null ? [0, 0, 0, 1] : [...sampleCurve(erosion.mixer, 0)];
  const rate = (feather: number) => 1 / Math.max(feather, LEAST_FEATHER);
  return {
    mapErosion: { value: texture },
    erosionDefault: { value: erosion?.map?.asset == null ? WHITE : NOTHING },
    addressErosion: { value: erosion?.addressMode ?? 0 },
    erosionMix: { value: [mix[0] ?? 0, mix[1] ?? 0, mix[2] ?? 0, mix[3] ?? 0] },
    featherRate: { value: [rate(erosion?.featherIn ?? 0), rate(erosion?.featherOut ?? 0)] },
    sliceWidth: { value: erosion?.sliceWidth ?? 0 },
  };
}

/** The defines an erosion shares across the three materials, off its definition. */
export function erosionDefines(erosion: ErosionModel | null, texture: Texture | null): Defines {
  return {
    ...(erosion !== null ? { EROSION: "" } : {}),
    ...(erosion !== null && texture !== null ? { HAS_MAP_EROSION: "" } : {}),
  };
}
