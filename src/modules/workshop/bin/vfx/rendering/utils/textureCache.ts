import { LinearFilter, type Texture, TextureLoader } from "three";

import { loadCubeTexture, PARTICLE_COLOR_SPACE } from "@/modules/viewport";

/** How a url decodes: one flat image, or the six faces of a cube map stacked. */
export type TextureForm = "flat" | "cube";

/** One reference to a cached texture, which keeps it alive until released. */
export interface TextureRef {
  /** The texture once it has landed, null while it loads or where it failed. */
  readonly texture: Texture | null;
  /** The texture, or null for a load that failed. The first call starts the load. */
  load(): Promise<Texture | null>;
  release(): void;
}

interface Entry {
  refs: number;
  texture: Texture | null;
  loading: Promise<Texture | null> | null;
}

const ENTRIES = new Map<string, Entry>();

const LOADER = new TextureLoader();

/**
 * A reference to the texture at `url`, shared by every reference to the same url.
 *
 * Every particle texture takes the same sampler state, so one upload serves every emitter,
 * slot and viewport naming it. The texture is disposed when its last reference is released.
 */
export function acquireTexture(url: string, form: TextureForm): TextureRef {
  let entry = ENTRIES.get(url);
  if (entry === undefined) {
    entry = { refs: 0, texture: null, loading: null };
    ENTRIES.set(url, entry);
  }
  entry.refs += 1;

  const shared = entry;
  let released = false;
  return {
    get texture() {
      return shared.texture;
    },
    load() {
      shared.loading ??= fetchTexture(url, form).then((texture) => {
        if (texture === null) return null;
        if (shared.refs === 0) {
          texture.dispose();
          return null;
        }
        shared.texture = texture;
        return texture;
      });
      return shared.loading;
    },
    release() {
      if (released) return;
      released = true;
      shared.refs -= 1;
      if (shared.refs > 0) return;

      shared.texture?.dispose();
      shared.texture = null;
      if (ENTRIES.get(url) === shared) ENTRIES.delete(url);
    },
  };
}

async function fetchTexture(url: string, form: TextureForm): Promise<Texture | null> {
  const texture =
    form === "cube"
      ? await loadCubeTexture(url).catch(() => null)
      : await LOADER.loadAsync(url).catch(() => null);
  if (texture === null) return null;

  texture.colorSpace = PARTICLE_COLOR_SPACE;
  /* The first row is `v = 0`, as DirectX samples it, which is the space every uv formula
     here is written in. */
  texture.flipY = false;
  texture.minFilter = LinearFilter;
  return texture;
}
