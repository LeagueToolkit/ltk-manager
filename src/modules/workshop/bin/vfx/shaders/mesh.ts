import { AXIS_SIGN } from "@/modules/viewport";

/**
 * The rim and the reflection `mesh_vs` hands the pixel pass, off the surface's facing.
 *
 * The reflected ray crosses the mirrored axis back, because a cube map is authored in the
 * engine's space. Decision 2.42 of docs/plans/vfx-particle-renderer.md.
 */
const SHEEN_VERTEX = /* glsl */ `
const vec3 AXIS = vec3(${AXIS_SIGN.join(", ")});

/* The least facing a power is taken of, which keeps a negative exponent finite edge on. */
const float LEAST_FACING = 1e-30;

#if SHEEN != 0
uniform vec4 fresnel;
uniform vec4 reflection;

varying vec3 vRim;
varying vec4 vReflect;

void facingTerms(vec3 world, vec3 surface) {
  vRim = vec3(0.0);
  vReflect = vec4(0.0);
  if (dot(surface, surface) == 0.0) return;
  vec3 ray = normalize(world - cameraPosition);
  vec3 normal = normalize(surface);
  float facing = max(clamp(dot(-ray, normal), 0.0, 1.0), LEAST_FACING);
  vRim = (1.0 - pow(facing, fresnel.w)) * fresnel.rgb;
  float glancing = 1.0 - pow(facing, reflection.x);
  vReflect = vec4(reflect(ray, normal) * AXIS, mix(reflection.y, reflection.z, glancing));
}
#else
void facingTerms(vec3 world, vec3 surface) {}
#endif
`;

/* The skinning chunks are three's own, declared under `USE_SKINNING`, which three defines
   for a `SkinnedMesh` whatever its material. */
export const ATTACHED_VERTEX = /* glsl */ `
#include <skinning_pars_vertex>
${SHEEN_VERTEX}

uniform vec4 particleTint;
uniform float particleErode;
uniform vec3 particleTurn;
uniform vec4 particleShift;
uniform vec3 particleTurnMult;
uniform vec4 particleShiftMult;

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vTurn;
varying vec4 vShift;
varying vec3 vTurnMult;
varying vec4 vShiftMult;
varying vec2 vLookup;
varying float vErode;

void main() {
  vUv = uv;
  vColor = particleTint;
  vTurn = particleTurn;
  vShift = particleShift;
  vTurnMult = particleTurnMult;
  vShiftMult = particleShiftMult;
  vLookup = vec2(0.0);
  vErode = particleErode;
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 world = modelMatrix * vec4(transformed, 1.0);
  facingTerms(world.xyz, mat3(modelMatrix) * objectNormal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/* `instanceMatrix` is three's own, written for an `InstancedMesh` by `setMatrixAt` and
   declared in its prefix under `USE_INSTANCING`. The tint is an attribute of the
   emitter's own geometry rather than `instanceColor`, which three types as a `vec3`. */
export const MESH_VERTEX = /* glsl */ `
${SHEEN_VERTEX}
attribute vec4 tint;
attribute float erode;
attribute vec3 uvTurn;
attribute vec4 uvShift;
attribute vec3 uvTurnMult;
attribute vec4 uvShiftMult;

varying vec2 vUv;
varying vec4 vColor;
varying vec3 vTurn;
varying vec4 vShift;
varying vec3 vTurnMult;
varying vec4 vShiftMult;
varying vec2 vLookup;
varying float vErode;

void main() {
  vUv = uv;
  vColor = tint;
  vTurn = uvTurn;
  vShift = uvShift;
  vTurnMult = uvTurnMult;
  vShiftMult = uvShiftMult;
  vLookup = vec2(0.0);
  vErode = erode;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  // The world matrix turns the normal as it turns the vertex, which is what mesh_vs does.
  facingTerms(world.xyz, mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
