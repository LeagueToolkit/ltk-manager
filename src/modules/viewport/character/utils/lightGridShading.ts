import { DoubleSide, MeshLambertMaterial, type WebGLProgramParametersWithUniforms } from "three";

import { CUBE_FACES, type LightGrid, sceneCubeAt } from "../../assets/parsing/lightGridBuffer";

/**
 * The uniforms a lit character material reads its map's baked ambient from.
 *
 * `cube` is in the scene's space. Its +X and -X faces are the engine's, swapped across
 * the mirrored axis. `on` is 0 where no grid lights the character, and ThreeJS's lights
 * shade it there. `selfIllumination` is the skin's, which `scale.y` weighs.
 */
export interface LightGridUniforms {
  readonly cube: { value: Float32Array };
  readonly scale: { value: [number, number] };
  readonly selfIllumination: { value: number };
  readonly on: { value: number };
}

/** The key every patched material shares. All of them draw with one program. */
const PROGRAM_KEY = "light-grid-2";

const VERTEX_DECLARATIONS = /* glsl */ `
uniform vec3 lightGridCube[${CUBE_FACES}];
varying vec3 vLightGrid;
`;

/* The ambient cube as the game's character vertex shader weighs it: the squared world
   normal, each axis taking the face its sign points at. The bones are world space there,
   and here the model matrix is a mirror and a uniform scale, so it turns a normal true. */
const VERTEX_AMBIENT = /* glsl */ `
vec3 gridNormal = normalize( mat3( modelMatrix ) * objectNormal );
vec3 gridWeight = gridNormal * gridNormal;
vLightGrid = gridWeight.x * lightGridCube[ gridNormal.x < 0.0 ? 1 : 0 ]
  + gridWeight.y * lightGridCube[ gridNormal.y < 0.0 ? 3 : 2 ]
  + gridWeight.z * lightGridCube[ gridNormal.z < 0.0 ? 5 : 4 ];
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec2 lightGridScale;
uniform float lightGridSelfIllumination;
uniform float lightGridOn;
varying vec3 vLightGrid;
`;

/* The game's light is `clamp(ambient * LIGHTGRID_SCALE.x + SELF_ILLUMINATION *
   LIGHTGRID_SCALE.y)`, multiplied by a gamma albedo. The light is in gamma space here too,
   and is converted to linear before it multiplies the linear albedo. */
const FRAGMENT_LIGHT = /* glsl */ `
if ( lightGridOn > 0.5 ) {
  vec3 gridLight = clamp(
    vLightGrid * lightGridScale.x + lightGridSelfIllumination * lightGridScale.y,
    0.0,
    1.0
  );
  outgoingLight = diffuseColor.rgb * sRGBTransferEOTF( vec4( gridLight, 1.0 ) ).rgb;
}
`;

/** Uniforms for one material, unlit by any grid until `lightFrom` fills them. */
export function lightGridUniforms(): LightGridUniforms {
  return {
    cube: { value: new Float32Array(CUBE_FACES * 3) },
    scale: { value: [0, 0] },
    selfIllumination: { value: 0 },
    on: { value: 0 },
  };
}

/**
 * Light `material` from the ambient cube in `uniforms`, where a grid sets one.
 *
 * The cube replaces the whole lit colour. The game's character shader reads no sun and no
 * other light under a grid.
 */
export function patchLightGrid(material: MeshLambertMaterial, uniforms: LightGridUniforms): void {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.lightGridCube = uniforms.cube;
    shader.uniforms.lightGridScale = uniforms.scale;
    shader.uniforms.lightGridSelfIllumination = uniforms.selfIllumination;
    shader.uniforms.lightGridOn = uniforms.on;
    shader.vertexShader = inject(
      shader.vertexShader,
      "#include <defaultnormal_vertex>",
      VERTEX_DECLARATIONS,
      VERTEX_AMBIENT,
    );
    shader.fragmentShader = inject(
      shader.fragmentShader,
      "#include <opaque_fragment>",
      FRAGMENT_DECLARATIONS,
      FRAGMENT_LIGHT,
      true,
    );
  };
  material.customProgramCacheKey = () => PROGRAM_KEY;
}

/** A double-sided, vertex-coloured character material lit by the grid in `uniforms`. */
export function gridLitMaterial(uniforms: LightGridUniforms): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ side: DoubleSide, vertexColors: true });
  patchLightGrid(material, uniforms);
  return material;
}

/**
 * Fill `uniforms` from the grid cell under `x`, `z` in the scene's space, and turn them
 * off where there is no grid. Answers the cell, so a caller can skip a frame that did
 * not change it.
 */
export function lightFrom(
  grid: LightGrid | null,
  x: number,
  z: number,
  uniforms: LightGridUniforms,
): number {
  if (grid === null) {
    uniforms.on.value = 0;
    return -1;
  }
  const cell = sceneCubeAt(grid, x, z, uniforms.cube.value);
  uniforms.scale.value = [1, grid.fullBright];
  uniforms.on.value = 1;
  return cell;
}

function inject(
  source: string,
  anchor: string,
  declarations: string,
  body: string,
  before = false,
): string {
  const placed = before ? `${body}\n${anchor}` : `${anchor}\n${body}`;
  return `${declarations}\n${source.replace(anchor, placed)}`;
}
