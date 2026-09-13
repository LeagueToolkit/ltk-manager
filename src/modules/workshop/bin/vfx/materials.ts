import { type Color, DoubleSide, ShaderMaterial, type Side, type Texture, Vector4 } from "three";

import { drawState, type FragmentTests } from "./blend";
import { type BlendMode, type SimpleOrientation, UV_MODE } from "./enums";
import { ATTACHED_VERTEX, MESH_VERTEX } from "./shaders/mesh";
import { FRAGMENT, VERTEX } from "./shaders/quad";
import { RIBBON_FRAGMENT, RIBBON_VERTEX } from "./shaders/ribbon";
import {
  ALPHA_LOCK,
  colorDefines,
  colorUniforms,
  type DepthBias,
  type DepthOffset,
  distortionDefines,
  distortionUniforms,
  erosionDefines,
  erosionUniforms,
  groundDefines,
  layerDefines,
  layerUniforms,
  multiplies,
  offsets,
  OVERLAY,
  polygonOffsetOf,
  type QuadLayers,
  SHEEN,
  sheenDefines,
  sheenUniforms,
  softDefines,
  softUniforms,
} from "./uniforms";
import { cellSize } from "./uvTransform";

/** How one emitter's quads are turned before they are drawn. */
export interface QuadOrientation {
  /** The quad faces the eye, spun about the view axis by its own rotation. */
  readonly billboard: boolean;
  /** `isDirectionOriented` on a billboard: its up follows the travel as the eye sees it, and no roll. */
  readonly directed: boolean;
  /** A ray: the quad lies along the particle's own `+Z`, and turns to face the eye about it. */
  readonly ray: boolean;
  /** A simple emitter's `orientation`: the world plane its quads lie in, if not the camera's. */
  readonly plane: SimpleOrientation;
  /** `VfxPrimitiveCameraUnitQuad`: the corner sits at half `scale0`, not at all of it. */
  readonly unitQuad: boolean;
  /** `scaleUpFromOrigin`: the quad grows from its base rather than about its centre. */
  readonly pivotUp: boolean;
}

/** How far up the quad its centre sits when it grows from its base, in corner units. */
const PIVOT_UP = 0.5;

/**
 * What a corner is multiplied by, `scale0` being a half-extent every quad spans twice.
 *
 * The simple emitter's own extent is `P +/- A +/- B`. `CAMERA_UNIT_QUAD` is the one kind
 * that halves it.
 */
const REACH = 2;
const UNIT_REACH = 1;

/**
 * The material one emitter's quads draw with.
 *
 * A camera quad faces the eye and takes only the roll of its rotation, which is
 * `ORIENTATION_CAMERA`. An arbitrary quad and a ray stand on the basis `Quads` builds
 * for the particle, its own rotation on the frame it was born in, or its travel under
 * `isDirectionOriented`.
 *
 * `depthBiasFactors` is a polygon offset and `DepthPushPull` moves each corner along
 * the ray from the eye, decision 2.47 of docs/plans/vfx-particle-renderer.md.
 */
export function quadMaterial(
  mode: BlendMode,
  texture: Texture | null,
  depth: DepthOffset,
  orientation: QuadOrientation,
  layers: QuadLayers,
  tests: FragmentTests,
): ShaderMaterial {
  const state = drawState(mode, layers.distortion !== null);

  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...layerUniforms(texture, layers, tests),
      ...softUniforms(mode, layers.soft),
      pushPull: { value: depth.pushPull },
      reach: { value: orientation.unitQuad ? UNIT_REACH : REACH },
      pivot: { value: orientation.pivotUp ? PIVOT_UP : 0 },
    },
    defines: {
      ...layerDefines(texture, layers),
      ...softDefines(layers.soft),
      FALLOFF: "",
      ...(orientation.billboard ? { BILLBOARD: "" } : {}),
      ...(orientation.directed ? { DIRECTED: "" } : {}),
      ...(orientation.ray ? { RAY: "" } : {}),
      PLANE: orientation.plane,
      ...groundDefines(layers),
    },
    side: DoubleSide,
    depthTest: tests.depthTest,
    depthWrite: state.depthWrite,
    transparent: state.transparent,
    blending: state.blending,
    blendSrc: state.blendSrc,
    blendDst: state.blendDst,
    blendEquation: state.blendEquation,
    blendSrcAlpha: state.blendSrcAlpha,
    blendDstAlpha: state.blendDstAlpha,
    ...polygonOffsetOf(depth.bias),
  });
}

/**
 * The material one emitter's mesh instances draw with.
 *
 * A mesh carries its own uvs and its own transform, and runs them through the fragment
 * pass a quad has: both layers' transforms, the palette and the erosion, per instance.
 * The colour ramp alone stays off, a mesh reading it at a per-emitter uniform in the
 * engine. The rim and the reflection come on top, which no quad shader compiles. `side`
 * is the emitter's `disableBackfaceCull`: the front alone unless it asks for both.
 */
export function meshMaterial(
  mode: BlendMode,
  texture: Texture | null,
  bias: DepthBias,
  layers: QuadLayers,
  tests: FragmentTests,
  side: Side,
): ShaderMaterial {
  const state = drawState(mode, layers.distortion !== null);

  return new ShaderMaterial({
    vertexShader: MESH_VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...layerUniforms(texture, { ...layers, colorTexture: null }, tests),
      ...sheenUniforms(layers.reflection, layers.reflectionTexture),
      ...softUniforms(mode, layers.soft),
    },
    defines: {
      ...layerDefines(texture, { ...layers, colorTexture: null }),
      ...sheenDefines(layers.reflection, layers.reflectionTexture, SHEEN.drawn),
      ...softDefines(layers.soft),
      LOCK_ALPHA: layers.mode === UV_MODE.lockAlpha ? ALPHA_LOCK.unscrolled : ALPHA_LOCK.none,
      ...groundDefines(layers),
    },
    side,
    depthTest: tests.depthTest,
    depthWrite: state.depthWrite,
    transparent: state.transparent,
    blending: state.blending,
    blendSrc: state.blendSrc,
    blendDst: state.blendDst,
    blendEquation: state.blendEquation,
    blendSrcAlpha: state.blendSrcAlpha,
    blendDstAlpha: state.blendDstAlpha,
    ...polygonOffsetOf(bias),
  });
}

/**
 * The material one particle of an attached mesh draws the character's skin with.
 *
 * The skin's own skinning places each vertex, and the particle's colour, layer transforms
 * and erosion drive arrive as uniforms, one material a particle, where a mesh emitter's
 * arrive as instanced attributes. An emitter authoring no `depthBiasFactors` takes
 * `OVERLAY` in their place. `skinnedmesh/particle_ps` compiles no soft fade, so the skin
 * fades nothing.
 */
export function attachedMaterial(
  mode: BlendMode,
  texture: Texture | null,
  bias: DepthBias,
  layers: QuadLayers,
  tests: FragmentTests,
  side: Side,
): ShaderMaterial {
  const material = meshMaterial(
    mode,
    texture,
    offsets(bias) ? bias : OVERLAY,
    { ...layers, soft: null },
    tests,
    side,
  );
  material.vertexShader = ATTACHED_VERTEX;
  material.defines = { ...material.defines, SHEEN: SHEEN.texel };
  Object.assign(material.uniforms, {
    particleTint: { value: [1, 1, 1, 1] },
    particleErode: { value: 1 },
    particleTurn: { value: [0, 1, 1] },
    particleShift: { value: [0, 0, 0, 0] },
    particleTurnMult: { value: [0, 1, 1] },
    particleShiftMult: { value: [0, 0, 0, 0] },
  });
  return material;
}

/**
 * The material a ribbon draws with: a trail through an emitter's particles, or a beam.
 *
 * A ribbon carries its own positions, a colour and a ramp lookup per vertex, and both
 * layers' uvs already run through the particle's transforms on the CPU, so it shares a
 * quad's blend state, palette, ramp, each layer's address mode and cell, and none of its
 * per-instance work. A ribbon draws with the quad's own bundle.
 */
export function ribbonMaterial(
  mode: BlendMode,
  texture: Texture | null,
  bias: DepthBias,
  layers: QuadLayers,
  tests: FragmentTests,
): ShaderMaterial {
  const state = drawState(mode, layers.distortion !== null);

  return new ShaderMaterial({
    vertexShader: RIBBON_VERTEX,
    fragmentShader: RIBBON_FRAGMENT,
    uniforms: {
      map: { value: texture },
      alphaRef: { value: tests.alphaRef },
      address: { value: layers.base.addressMode },
      cellSize: { value: cellSize(layers.base) },
      mapMult: { value: layers.multTexture },
      cellMult: { value: layers.mult === null ? [1, 1] : cellSize(layers.mult) },
      addressMult: { value: layers.mult?.addressMode ?? 0 },
      ...colorUniforms(layers),
      ...erosionUniforms(layers.erosion, layers.erosionTexture),
      ...distortionUniforms(layers.distortion, layers.normalTexture),
      ...softUniforms(mode, layers.soft),
    },
    defines: {
      ...(texture !== null ? { HAS_MAP: "" } : {}),
      ...(multiplies(layers) ? { HAS_MAP_MULT: "" } : {}),
      LOCK_ALPHA: layers.mode === UV_MODE.lockAlpha ? ALPHA_LOCK.corner : ALPHA_LOCK.none,
      ...colorDefines(layers),
      ...erosionDefines(layers.erosion, layers.erosionTexture),
      ...distortionDefines(layers.distortion, layers.normalTexture),
      ...softDefines(layers.soft),
      ...groundDefines(layers),
    },
    side: DoubleSide,
    depthTest: tests.depthTest,
    depthWrite: state.depthWrite,
    transparent: state.transparent,
    blending: state.blending,
    blendSrc: state.blendSrc,
    blendDst: state.blendDst,
    blendEquation: state.blendEquation,
    blendSrcAlpha: state.blendSrcAlpha,
    blendDstAlpha: state.blendDstAlpha,
    ...polygonOffsetOf(bias),
  });
}

/**
 * `solid` drawn as its triangle edges in one flat `colour` at `opacity`, over its uniforms.
 *
 * The uniform objects are the solid's, so a frame's write to one reaches both. The particle
 * shaders write their colour as it stands, which the canvas reads as sRGB.
 */
export function wireMaterial(
  solid: ShaderMaterial,
  colour: Color,
  opacity: number,
): ShaderMaterial {
  const { r, g, b } = colour.clone().convertLinearToSRGB();
  return new ShaderMaterial({
    vertexShader: solid.vertexShader,
    fragmentShader: solid.fragmentShader,
    uniforms: { ...solid.uniforms, wireColor: { value: new Vector4(r, g, b, opacity) } },
    defines: { ...solid.defines, WIREFRAME: "" },
    wireframe: true,
    side: DoubleSide,
    depthTest: solid.depthTest,
    depthWrite: false,
    transparent: true,
  });
}
