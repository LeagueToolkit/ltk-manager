import type { AssetRef, PassProgram, SkinModel } from "@/lib/tauri";
import type { SubmeshProgram } from "@/modules/viewport";

import { submeshMaterial } from "./skinScene";

/** The colour texture `LIT_UBER` samples, as the pass read names it. */
export const DEFAULT_DIFFUSE = "DIFFUSE_MAP";

/** The emissive mask `LIT_UBER` samples, as the pass read names it. */
export const DEFAULT_EMISSIVE = "EMISSIVE_MAP";

/** The key the skin's emissive texture loads under. */
export const EMISSIVE_KEY = "emissive";

/** The key the colour texture of a submesh no override names loads under. */
const BASE_KEY = "base";

function overrideKey(submesh: string): string {
  return `submesh:${submesh.toLowerCase()}`;
}

/** Whether a submesh of `skin` draws with the engine's default program. */
export function drawsDefaultProgram(skin: SkinModel): boolean {
  return skin.material === null || skin.overrides.some((override) => override.material === null);
}

/** Every texture the default program draws `skin` with, keyed for `defaultProgramOf`. */
export function defaultProgramAssets(skin: SkinModel): Map<string, AssetRef> {
  const assets = new Map<string, AssetRef>();
  if (skin.texture?.asset) assets.set(BASE_KEY, skin.texture.asset);
  for (const override of skin.overrides) {
    if (override.material === null && override.texture?.asset) {
      assets.set(overrideKey(override.submesh), override.texture.asset);
    }
  }
  if (skin.emissiveTexture?.asset) assets.set(EMISSIVE_KEY, skin.emissiveTexture.asset);
  return assets;
}

/**
 * The engine's default program for a `submesh` its skin names no material for, with the
 * submesh's colour texture and the skin's emissive texture.
 *
 * Null for a submesh a material covers, and while `program` is unread or untranslated.
 * Each colour texture gets a separate material. A program material binds one texture
 * per name.
 */
export function defaultProgramOf<T>(
  skin: SkinModel,
  program: PassProgram | null,
  textures: ReadonlyMap<string, T>,
  submesh: string,
): SubmeshProgram<T> | null {
  if (program === null || program.program.kind !== "ready") return null;
  if (submeshMaterial(skin, submesh) !== null) return null;

  const key = textures.has(overrideKey(submesh)) ? overrideKey(submesh) : BASE_KEY;
  const bound = new Map<string, T>();
  const diffuse = textures.get(key);
  if (diffuse !== undefined) bound.set(DEFAULT_DIFFUSE, diffuse);
  const emissive = textures.get(EMISSIVE_KEY);
  if (emissive !== undefined) bound.set(DEFAULT_EMISSIVE, emissive);

  return {
    material: `${program.pass.shader ?? ""}:${key}`,
    pass: program.pass,
    program: program.program,
    textures: bound,
  };
}
