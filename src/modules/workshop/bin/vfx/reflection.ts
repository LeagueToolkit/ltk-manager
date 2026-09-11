import type { ReflectionModel } from "./model";

/** Four lanes of a shader constant, in the order the shader reads them. */
type Lanes = readonly [number, number, number, number];

/**
 * `vFresnel`: `fresnelColor`'s three channels, then `fresnel`, the exponent the rim takes.
 *
 * `mesh_vs` reads the fourth lane as the exponent, so the colour's own alpha has no lane.
 * Decision 2.42 of docs/plans/vfx-particle-renderer.md.
 */
export function fresnelLanes(reflection: ReflectionModel | null): Lanes {
  if (reflection === null) return [0, 0, 0, 1];
  const [red, green, blue] = reflection.fresnelColor;
  return [red, green, blue, reflection.fresnel];
}

/** `vReflection`: `reflectionFresnel`, then the opacity facing the eye and the opacity edge on. */
export function reflectionLanes(reflection: ReflectionModel | null): Lanes {
  if (reflection === null) return [1, 0, 1, 0];
  return [reflection.reflectionFresnel, reflection.opacityDirect, reflection.opacityGlancing, 0];
}

/** `vReflectionFColor`, the colour the reflection is tinted toward as its opacity rises. */
export function reflectionTint(
  reflection: ReflectionModel | null,
): readonly [number, number, number] {
  if (reflection === null) return [1, 1, 1];
  const [red, green, blue] = reflection.reflectionFresnelColor;
  return [red, green, blue];
}
