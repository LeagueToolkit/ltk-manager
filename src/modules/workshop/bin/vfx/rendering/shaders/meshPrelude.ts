import { AXIS_SIGN, type VertexPrelude } from "@/modules/viewport";

import { PARTICLE_POSE } from "./mesh";
import { GROUND, LAYER_UV } from "./quad";

/**
 * What the engine binds for one mesh particle's draw, out of the instanced attributes of
 * `meshBuffers`, which the translated `mesh_vs` and `distortion_mesh_vs` read.
 *
 * - `POSITION` and `NORMAL` are the posed vertex in the engine's space, and `mWorld` carries
 *   it into the world across the mirror and back, so the environment's clip transform takes
 *   the mirror once more.
 * - `kColorFactor` is the tint, already premultiplied where the blend mode asks.
 * - `vParticleUVTransform` and its mult twin are each layer's transform placed in its cell,
 *   as `uvRowsInto` states it.
 * - `COLOR_LOOKUP_UV` and the drive in `cAlphaErosionParams.x` are the pixel stage's, and
 *   the rest of that register is `erosionBand`.
 *
 * The engine binds these once a draw, and a draw is one particle. `GROUND_LAYER` flattens the
 * vertex in the world under an identity `mWorld`, so the normal keeps its height as the
 * hand-written mesh keeps it. `PARTICLE_SKINNING` is `PARTICLE_POSE`'s.
 */
export const MESH_PRELUDE: VertexPrelude = {
  source: /* glsl */ `
in vec3 position;
in vec3 normal;
in vec2 uv;
in mat4 instanceMatrix;
in vec4 tint;
in vec3 lookup;
in vec3 uvTurn;
in vec4 uvShift;
in vec3 uvTurnMult;
in vec4 uvShiftMult;

uniform mat4 modelMatrix;
uniform vec2 cell;
uniform vec2 uvCenter;
uniform vec2 flip;
uniform vec2 cellMult;
uniform vec2 uvCenterMult;
uniform vec2 flipMult;
uniform vec3 erosionBand;

const vec3 AXIS = vec3(${AXIS_SIGN.join(", ")});

${GROUND}
${PARTICLE_POSE}
${LAYER_UV}

void uvRows(vec3 turn, vec4 shift, vec2 about, vec2 mirrored, vec2 size, out vec4 u, out vec4 v) {
  vec2 origin = shift.zw + layerUv(vec2(0.0), turn, shift, about, mirrored) * size;
  vec2 along = shift.zw + layerUv(vec2(1.0, 0.0), turn, shift, about, mirrored) * size - origin;
  vec2 across = shift.zw + layerUv(vec2(0.0, 1.0), turn, shift, about, mirrored) * size - origin;
  u = vec4(along.x, across.x, origin.x, 0.0);
  v = vec4(along.y, across.y, origin.y, 0.0);
}

void enginePrelude() {
  vec3 posedPosition = position;
  vec3 posedNormal = normal;
  pose(posedPosition, posedNormal);
  engine_POSITION = vec4(posedPosition * AXIS, 1.0);
  engine_NORMAL = vec4(posedNormal * AXIS, 0.0);
  engine_TEXCOORD = vec4(uv, 0.0, 0.0);

  mat4 mirror = mat4(1.0);
  mirror[0][0] = AXIS.x;
  mirror[1][1] = AXIS.y;
  mirror[2][2] = AXIS.z;
  mat4 world = mirror * modelMatrix * instanceMatrix * mirror;
#ifdef GROUND_LAYER
  engine_POSITION = world * engine_POSITION;
  engine_POSITION.y = GROUND_LEVEL * AXIS.y;
  engine_NORMAL = vec4(mat3(world) * engine_NORMAL.xyz, 0.0);
  world = mat4(1.0);
#endif
  for (int row = 0; row < 4; row++) {
    engine_mWorld[row] = vec4(world[0][row], world[1][row], world[2][row], world[3][row]);
  }

  engine_kColorFactor[0] = tint;
  uvRows(uvTurn, uvShift, uvCenter, flip, cell,
    engine_vParticleUVTransform[0], engine_vParticleUVTransform[1]);
  uvRows(uvTurnMult, uvShiftMult, uvCenterMult, flipMult, cellMult,
    engine_vParticleUVTransformMult[0], engine_vParticleUVTransformMult[1]);
  engine_COLOR_LOOKUP_UV[0] = vec4(lookup.xy, 0.0, 0.0);
  engine_cAlphaErosionParams[0] = vec4(lookup.z, erosionBand);
}
`,
  inputs: ["a_POSITION", "a_NORMAL", "a_TEXCOORD"],
  members: {
    mWorld: 4,
    kColorFactor: 1,
    vParticleUVTransform: 2,
    vParticleUVTransformMult: 2,
    COLOR_LOOKUP_UV: 1,
    cAlphaErosionParams: 1,
  },
};
