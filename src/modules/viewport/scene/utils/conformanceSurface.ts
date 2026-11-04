/**
 * Builds the `conformance` surface of the backdrop, which colors the ground by its height minus
 * the navigation grid height under it. Per section 3.7 of docs/plans/navgrid-guides.md.
 */

import {
  Color,
  DataTexture,
  FloatType,
  type IUniform,
  MeshLambertMaterial,
  NearestFilter,
  RedFormat,
  Vector2,
} from "three";

import type { NavGrid } from "../../assets/parsing/navGridBuffer";

/** The navigation grid that the `conformance` surface measures the ground against. */
export interface ConformanceGround {
  readonly grid: NavGrid;
  /** The largest height difference that draws neutral, in world units. */
  readonly threshold: number;
}

/** The uniforms that every `conformance` material of one backdrop shares. */
export interface ConformanceUniforms {
  readonly conformanceHeights: IUniform<DataTexture | null>;
  /** The world `x` and `z` of the first height sample. */
  readonly conformanceOrigin: IUniform<Vector2>;
  /** The world units between two samples along `x` and `z`. */
  readonly conformanceSpacing: IUniform<Vector2>;
  /** The index of the last sample along `x` and `z`. */
  readonly conformanceLast: IUniform<Vector2>;
  readonly conformanceThreshold: IUniform<number>;
  readonly conformanceWall: IUniform<Color>;
  readonly conformanceNeutral: IUniform<Color>;
  readonly conformanceWarmNear: IUniform<Color>;
  readonly conformanceWarmFar: IUniform<Color>;
  readonly conformanceCoolNear: IUniform<Color>;
  readonly conformanceCoolFar: IUniform<Color>;
}

/** The key that every `conformance` material shares. All of them draw with one program. */
const PROGRAM_KEY = "conformance-surface-1";

/* The normal `y` under which a triangle is a wall or a cliff, the bound that `map_conformance`
   uses for ground. A difference ramps from the near to the far color over `SPAN` thresholds
   past the threshold. */
const SHADER_DECLARATIONS = /* glsl */ `
const float CONFORMANCE_GROUND = 0.7;
const float CONFORMANCE_SPAN = 3.0;
uniform highp sampler2D conformanceHeights;
uniform vec2 conformanceOrigin;
uniform vec2 conformanceSpacing;
uniform vec2 conformanceLast;
uniform float conformanceThreshold;
uniform vec3 conformanceWall;
uniform vec3 conformanceNeutral;
uniform vec3 conformanceWarmNear;
uniform vec3 conformanceWarmFar;
uniform vec3 conformanceCoolNear;
uniform vec3 conformanceCoolFar;
`;

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vConformancePosition;
varying float vConformanceUp;
`;

/* The mesh draws in the engine's space inside the mirrored group, so its own position and
   normal are the engine's and no mirror has to be undone. */
const VERTEX = /* glsl */ `
vConformancePosition = transformed;
vConformanceUp = objectNormal.y;
`;

/* WebGL2 does not filter a 32-bit float texture without an extension, so the height reads
   the four samples around it and interpolates them as `sampledHeightAt` does. */
const FRAGMENT_FUNCTIONS = /* glsl */ `
float conformanceHeight( ivec2 at ) {
  return texelFetch( conformanceHeights, at, 0 ).r;
}

vec3 conformanceColor( vec3 outside ) {
  vec2 position = ( vConformancePosition.xz - conformanceOrigin ) / conformanceSpacing;
  if ( any( lessThan( position, vec2( 0.0 ) ) ) || any( greaterThan( position, conformanceLast ) ) ) {
    return outside;
  }
  if ( vConformanceUp < CONFORMANCE_GROUND ) {
    return conformanceWall;
  }

  ivec2 last = ivec2( conformanceLast );
  ivec2 first = min( ivec2( floor( position ) ), last );
  ivec2 second = min( first + 1, last );
  vec2 weight = position - vec2( first );
  float nearRow = mix( conformanceHeight( first ), conformanceHeight( ivec2( second.x, first.y ) ), weight.x );
  float farRow = mix( conformanceHeight( ivec2( first.x, second.y ) ), conformanceHeight( second ), weight.x );
  float difference = vConformancePosition.y - mix( nearRow, farRow, weight.y );

  float excess = abs( difference ) - conformanceThreshold;
  if ( excess <= 0.0 ) {
    return conformanceNeutral;
  }

  float ramp = clamp( excess / max( conformanceThreshold * CONFORMANCE_SPAN, 1.0 ), 0.0, 1.0 );
  return difference > 0.0
    ? mix( conformanceWarmNear, conformanceWarmFar, ramp )
    : mix( conformanceCoolNear, conformanceCoolFar, ramp );
}
`;

const FRAGMENT = /* glsl */ `
diffuseColor.rgb = conformanceColor( diffuseColor.rgb );
`;

/** Wall and cliff fragments, which are not ground. */
const WALL = 0x6e6b66;

/** Ground within the threshold. */
const NEUTRAL = 0xd6d2c8;

/** Ground above the navigation grid, at the threshold and at `CONFORMANCE_SPAN` past it. */
const WARM = [0xf0a35e, 0xc4321c] as const;

/** Ground below the navigation grid, at the threshold and at `CONFORMANCE_SPAN` past it. */
const COOL = [0x7fb0e6, 0x1f4cbf] as const;

/** Returns the uniforms of one backdrop's `conformance` materials, with no grid set. */
export function createConformanceUniforms(): ConformanceUniforms {
  return {
    conformanceHeights: { value: null },
    conformanceOrigin: { value: new Vector2() },
    conformanceSpacing: { value: new Vector2(1, 1) },
    conformanceLast: { value: new Vector2() },
    conformanceThreshold: { value: 0 },
    conformanceWall: { value: new Color(WALL) },
    conformanceNeutral: { value: new Color(NEUTRAL) },
    conformanceWarmNear: { value: new Color(WARM[0]) },
    conformanceWarmFar: { value: new Color(WARM[1]) },
    conformanceCoolNear: { value: new Color(COOL[0]) },
    conformanceCoolFar: { value: new Color(COOL[1]) },
  };
}

/**
 * Writes `ground` and its `heights` texture into `uniforms`.
 *
 * Writes nothing if `ground` is null, and the materials keep the grid that they last drew.
 */
export function writeConformanceUniforms(
  uniforms: ConformanceUniforms,
  ground: ConformanceGround | null,
  heights: DataTexture | null,
): void {
  if (ground === null) {
    return;
  }

  const { grid } = ground;
  uniforms.conformanceHeights.value = heights;
  uniforms.conformanceOrigin.value.set(grid.min[0], grid.min[2]);
  uniforms.conformanceSpacing.value.set(grid.xSpacing, grid.ySpacing);
  uniforms.conformanceLast.value.set(grid.xSamples - 1, grid.ySamples - 1);
  uniforms.conformanceThreshold.value = ground.threshold;
}

/**
 * Returns an `R32F` texture of the height samples of a grid, texel `i`, `j` for sample
 * `i + j * width`.
 *
 * The texture reads `samples` in place, so the caller keeps them unchanged while it lives.
 */
export function createHeightTexture(
  samples: Float32Array,
  width: number,
  height: number,
): DataTexture {
  const texture = new DataTexture(samples, width, height, RedFormat, FloatType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Returns a lit material that colors each fragment by its height minus the navigation grid
 * height in `uniforms`.
 *
 * A fragment outside the samples keeps the material's own color, which a binding without a
 * texture sets to the `untextured` neutral.
 */
export function createConformanceMaterial(uniforms: ConformanceUniforms): MeshLambertMaterial {
  const material = new MeshLambertMaterial();

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `${VERTEX_DECLARATIONS}${shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>${VERTEX}`,
    )}`;
    shader.fragmentShader = `${SHADER_DECLARATIONS}${VERTEX_DECLARATIONS}${FRAGMENT_FUNCTIONS}${shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>${FRAGMENT}`,
    )}`;
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}
