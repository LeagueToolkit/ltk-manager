import type { AssetRef, MaterialProgram } from "@/lib/tauri";

/** Shader texture names that carry a material's base colour, as the game's shaders spell them. */
const BASE_COLOUR = /diffuse|albedo|base|colou?r|main/i;

/**
 * The texture a material with no translated pass is drawn with: its base colour where a
 * pass names one, else the first texture any pass names, and null without one.
 */
export function fallbackTexture(program: MaterialProgram): AssetRef | null {
  const assets = program.passes.flatMap((pass) =>
    pass.pass.textures.flatMap((texture) =>
      texture.texture?.asset ? [{ name: texture.name, asset: texture.texture.asset }] : [],
    ),
  );

  return (assets.find((texture) => BASE_COLOUR.test(texture.name)) ?? assets[0])?.asset ?? null;
}
