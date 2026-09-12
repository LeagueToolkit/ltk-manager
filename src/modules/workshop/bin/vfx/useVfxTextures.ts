import { useEffect, useState } from "react";
import { CubeTexture, DataTexture, LinearFilter, type Texture, TextureLoader } from "three";

import { previewCubeUrl } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";
import { PARTICLE_COLOR_SPACE } from "@/modules/viewport";

import { previewUrl } from "../../preview/assetRef";
import type { DrawnEmitter } from "./definitions";

/** The samplers one emitter draws with, null for one it names nothing for or that has not arrived. */
export interface EmitterSamplers {
  readonly base: Texture | null;
  readonly mult: Texture | null;
  readonly color: Texture | null;
  readonly palette: Texture | null;
  readonly erosion: Texture | null;
  /** `normalMapTexture`, whose direction a distorting emitter warps the screen along. */
  readonly normal: Texture | null;
  /** `reflectionMapTexture`, the cube map a mesh reflects. */
  readonly reflection: Texture | null;
}

/** One bundle per drawn emitter, by the drawn emitter's key. */
export type VfxTextures = ReadonlyMap<string, EmitterSamplers>;

const EMPTY: VfxTextures = new Map();

/** No sampler of the emitter's has arrived. */
export const NO_SAMPLERS: EmitterSamplers = Object.freeze({
  base: null,
  mult: null,
  color: null,
  palette: null,
  erosion: null,
  normal: null,
  reflection: null,
});

/**
 * What slot 0 holds for an emitter naming no texture, the engine's 1x1 transparent black.
 *
 * Such an emitter draws nothing of its own and carries only its children.
 */
const UNNAMED = unnamedTexture();

function unnamedTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/** `NO_SAMPLERS`, its base slot seeded with `UNNAMED` for an emitter naming no texture. */
export const UNNAMED_SAMPLERS: EmitterSamplers = Object.freeze({ ...NO_SAMPLERS, base: UNNAMED });

/** The samplers `definition` draws with: the held bundle, or a stand-in before one arrives. */
export function samplersOf(textures: VfxTextures, definition: DrawnEmitter): EmitterSamplers {
  const held = textures.get(definition.key);
  if (held !== undefined) return held;
  return definition.emitter.texture === null ? UNNAMED_SAMPLERS : NO_SAMPLERS;
}

/** The faces a cube map holds. */
const CUBE_FACES = 6;

/** A decode that keeps the file's bytes, neither premultiplied nor colour managed. */
const RAW: ImageBitmapOptions = { premultiplyAlpha: "none", colorSpaceConversion: "none" };

/**
 * The cube map `previewCubeUrl` answers, six square faces stacked top to bottom.
 *
 * Cut into bitmaps rather than drawn through a canvas, which would premultiply the alpha
 * and lose the colour under a transparent texel. Null for a map the scheme cannot answer.
 */
async function cubeOf(url: string): Promise<CubeTexture | null> {
  const answer = await fetch(url);
  if (!answer.ok) return null;

  const strip = await createImageBitmap(await answer.blob(), RAW);
  const size = strip.width;
  const faces = await Promise.all(
    Array.from({ length: CUBE_FACES }, (_, face) =>
      createImageBitmap(strip, 0, face * size, size, size, RAW),
    ),
  );
  strip.close();

  const cube = new CubeTexture(faces);
  cube.generateMipmaps = false;
  cube.needsUpdate = true;
  return cube;
}

/**
 * The textures each drawn emitter draws with, loaded off the `ltk-asset` scheme.
 *
 * The pixels never cross the JavaScript heap and the renderer adds no decode path
 * (decision 2.2 of docs/plans/vfx-particle-renderer.md). An emitter whose texture the
 * install does not ship draws untextured rather than not at all.
 */
export function useVfxTextures(drawn: readonly DrawnEmitter[]): VfxTextures {
  const [textures, setTextures] = useState<VfxTextures>(EMPTY);

  useEffect(() => {
    if (drawn.length === 0) {
      setTextures(EMPTY);
      return;
    }

    let live = true;
    const bundles = new Map<string, EmitterSamplers>();
    for (const { key, emitter } of drawn) {
      if (emitter.texture === null) bundles.set(key, UNNAMED_SAMPLERS);
    }
    setTextures(new Map(bundles));

    const loader = new TextureLoader();

    const take = (key: string, slot: keyof EmitterSamplers, texture: Texture) => {
      if (!live) {
        texture.dispose();
        return;
      }
      texture.colorSpace = PARTICLE_COLOR_SPACE;
      /* The first row is `v = 0`, as DirectX samples it, which is the space every uv
         formula here is written in. */
      texture.flipY = false;
      texture.minFilter = LinearFilter;
      const held = bundles.get(key) ?? NO_SAMPLERS;
      bundles.set(key, { ...held, [slot]: texture });
      setTextures(new Map(bundles));
    };

    for (const { key, emitter } of drawn) {
      const wanted: [keyof EmitterSamplers, AssetRef | null][] = [
        ["base", emitter.texture?.asset ?? null],
        ["mult", emitter.multTexture?.asset ?? null],
        ["color", emitter.colorTexture?.asset ?? null],
        ["palette", emitter.palette?.texture?.asset ?? null],
        ["erosion", emitter.erosion?.map?.asset ?? null],
        ["normal", emitter.distortion?.map?.asset ?? null],
      ];
      for (const [slot, asset] of wanted) {
        if (asset === null) continue;
        loader.load(
          previewUrl(asset),
          (texture) => take(key, slot, texture),
          undefined,
          () => {},
        );
      }

      const cube = emitter.reflection?.map?.asset ?? null;
      if (cube !== null) {
        void cubeOf(previewCubeUrl(cube))
          .then((texture) => texture !== null && take(key, "reflection", texture))
          .catch(() => {});
      }
    }

    return () => {
      live = false;
      for (const bundle of bundles.values()) {
        for (const texture of Object.values(bundle)) {
          if (texture !== null && texture !== UNNAMED) texture.dispose();
        }
      }
      setTextures(EMPTY);
    };
  }, [drawn]);

  return textures;
}
