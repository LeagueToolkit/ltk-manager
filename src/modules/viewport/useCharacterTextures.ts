import { useEffect, useState } from "react";
import { type Texture, TextureLoader } from "three";

import { previewUrl } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";

import { TEXTURE_COLOR_SPACE } from "./world";

const NONE: ReadonlyMap<string, Texture> = new Map();

/**
 * Each asset as a texture a character draws with, under the key it was asked by.
 *
 * A texture lands on its own, so the map grows as they arrive. The caller holds `assets`
 * stable, because a new map is a new set of loads.
 */
export function useCharacterTextures(
  assets: ReadonlyMap<string, AssetRef>,
): ReadonlyMap<string, Texture> {
  const [textures, setTextures] = useState(NONE);

  useEffect(() => {
    let live = true;
    const loaded = new Map<string, Texture>();
    const loader = new TextureLoader();

    for (const [key, asset] of assets) {
      loader.load(
        previewUrl(asset),
        (texture) => {
          if (!live) {
            texture.dispose();
            return;
          }
          texture.colorSpace = TEXTURE_COLOR_SPACE;
          /* The first row is `v = 0`, as DirectX samples it and a `.skn` is unwrapped. */
          texture.flipY = false;
          loaded.set(key, texture);
          setTextures(new Map(loaded));
        },
        undefined,
        (error) => console.error("Failed to read a character texture:", error),
      );
    }

    return () => {
      live = false;
      for (const texture of loaded.values()) texture.dispose();
      setTextures(NONE);
    };
  }, [assets]);

  return textures;
}
