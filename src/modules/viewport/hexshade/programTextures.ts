import type { Texture } from "three";

import type { AssetRef, MaterialProgram } from "@/lib/tauri";

import type { SubmeshProgram } from "./programMaterial";

/** The key a pass texture is loaded under, one per material, pass and shader texture name. */
export function programTextureKey(material: string, pass: number, texture: string): string {
  return `program:${material}:${pass}:${texture}`;
}

/**
 * Every texture a translated program samples and this machine holds, keyed for
 * [`programPasses`].
 */
export function programTextureAssets(
  programs: readonly (MaterialProgram | null)[],
): Map<string, AssetRef> {
  const assets = new Map<string, AssetRef>();
  for (const program of programs) {
    if (program === null) continue;
    for (const [index, pass] of program.passes.entries()) {
      if (pass.program.kind !== "ready") continue;
      for (const texture of pass.pass.textures) {
        if (texture.texture?.asset) {
          assets.set(programTextureKey(program.hash, index, texture.name), texture.texture.asset);
        }
      }
    }
  }
  return assets;
}

/**
 * What draws under `program`: every pass that translated, in draw order, each with the
 * textures of `textures` it names. Empty where no pass translated.
 */
export function programPasses<T = Texture>(
  program: MaterialProgram | null,
  textures: ReadonlyMap<string, T>,
): SubmeshProgram<T>[] {
  if (program === null) return [];

  const passes: SubmeshProgram<T>[] = [];
  for (const [index, pass] of program.passes.entries()) {
    if (pass.program.kind !== "ready") continue;

    const held = new Map<string, T>();
    for (const texture of pass.pass.textures) {
      const loaded = textures.get(programTextureKey(program.hash, index, texture.name));
      if (loaded !== undefined) held.set(texture.name, loaded);
    }
    passes.push({
      material: program.hash,
      index,
      pass: pass.pass,
      program: pass.program,
      textures: held,
    });
  }
  return passes;
}

/** The first pass of `programPasses`, and null where no pass translated. */
export function programWith<T = Texture>(
  program: MaterialProgram | null,
  textures: ReadonlyMap<string, T>,
): SubmeshProgram<T> | null {
  return programPasses(program, textures)[0] ?? null;
}
