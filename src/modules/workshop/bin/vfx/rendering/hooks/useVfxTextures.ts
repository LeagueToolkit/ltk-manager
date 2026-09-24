import { useEffect, useMemo, useRef, useState } from "react";
import { DataTexture, type Texture } from "three";

import { previewCubeUrl } from "@/lib/previewUrl";

import { previewUrl } from "../../../../preview/utils/assetRef";
import { assetLoad, type AssetLoad } from "../utils/assetLoad";
import type { DrawnEmitter } from "../utils/definitions";
import { acquireTexture, type TextureRef } from "../utils/textureCache";

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
 * What slot 0 binds for an emitter naming no texture, the engine's 1x1 transparent black.
 *
 * Such an emitter draws nothing itself and carries only its children.
 */
const UNNAMED = unnamedTexture();

function unnamedTexture(): DataTexture {
  const texture = new DataTexture(new Uint8Array(4), 1, 1);
  texture.needsUpdate = true;
  return texture;
}

/** `NO_SAMPLERS`, its base slot seeded with `UNNAMED` for an emitter naming no texture. */
export const UNNAMED_SAMPLERS: EmitterSamplers = Object.freeze({ ...NO_SAMPLERS, base: UNNAMED });

/** The samplers `definition` draws with: the loaded bundle, or a placeholder before one arrives. */
export function samplersOf(textures: VfxTextures, definition: DrawnEmitter): EmitterSamplers {
  const loaded = textures.get(definition.key);
  if (loaded !== undefined) return loaded;
  return definition.emitter.texture === null ? UNNAMED_SAMPLERS : NO_SAMPLERS;
}

/** One sampler slot of one drawn emitter, and the url it loads from, null for an unshipped asset. */
interface TextureRequest {
  /** The slot and its url together, the key a reference is reused under across edits. */
  readonly id: string;
  readonly key: string;
  readonly slot: keyof EmitterSamplers;
  readonly url: string | null;
}

/** Every slot the drawn emitters name, and the emitters that name no base texture. */
interface TextureRequests {
  readonly requests: readonly TextureRequest[];
  readonly unnamed: readonly string[];
  /** Everything the load depends on, which an edit leaves the same unless it moved an asset. */
  readonly signature: string;
}

function textureRequests(drawn: readonly DrawnEmitter[], minWidth?: number): TextureRequests {
  const requests: TextureRequest[] = [];
  const unnamed: string[] = [];

  for (const { key, emitter } of drawn) {
    if (emitter.texture === null) unnamed.push(key);

    const named = [
      ["base", emitter.texture],
      ["mult", emitter.multTexture],
      ["color", emitter.colorTexture],
      ["palette", emitter.palette?.texture ?? null],
      ["erosion", emitter.erosion?.map ?? null],
      ["normal", emitter.distortion?.map ?? null],
      ["reflection", emitter.reflection?.map ?? null],
    ] as const;
    for (const [slot, asset] of named) {
      if (asset === null) continue;

      let url: string | null = null;
      if (asset.asset != null) {
        url =
          slot === "reflection" ? previewCubeUrl(asset.asset) : previewUrl(asset.asset, minWidth);
      }
      requests.push({ id: `${key}|${slot}|${url ?? ""}`, key, slot, url });
    }
  }

  const signature = `${unnamed.join(",")}\n${requests.map(({ id }) => id).join("\n")}`;
  return { requests, unnamed, signature };
}

/**
 * The textures each drawn emitter draws with, loaded off the `ltk-asset` scheme.
 *
 * The pixels never cross the JavaScript heap and the renderer adds no decode path
 * (decision 2.2 of docs/plans/vfx-particle-renderer.md). An emitter whose texture the
 * install does not ship draws untextured rather than not at all.
 *
 * The load follows the asset urls rather than the identity of `drawn`, so an edit that
 * moves no asset keeps every texture, and one that does reloads only what it moved. The
 * textures come from `textureCache.ts`, so emitters and viewports naming one url share it.
 */
export function useVfxTextures(
  drawn: readonly DrawnEmitter[],
  report?: (load: AssetLoad) => void,
  minWidth?: number,
): VfxTextures {
  const [textures, setTextures] = useState<VfxTextures>(EMPTY);
  const wanted = useMemo(() => textureRequests(drawn, minWidth), [drawn, minWidth]);
  const latest = useRef(wanted);
  latest.current = wanted;

  /* The references outlive one run of the load effect, so the next run reuses them before
     releasing the rest. The unmount effect below releases them all. */
  const refs = useRef(new Map<string, TextureRef>());
  const shown = useRef<VfxTextures>(EMPTY);

  useEffect(() => {
    const { requests, unnamed } = latest.current;
    const previous = refs.current;
    const next = new Map<string, TextureRef>();
    const batch = assetLoad(requests.length, report);
    let live = true;

    const bundles = new Map<string, EmitterSamplers>();
    for (const key of unnamed) bundles.set(key, UNNAMED_SAMPLERS);

    const place = (key: string, slot: keyof EmitterSamplers, texture: Texture) => {
      const bundle = bundles.get(key) ?? NO_SAMPLERS;
      bundles.set(key, { ...bundle, [slot]: texture });
    };

    const queue: { request: TextureRequest; ref: TextureRef }[] = [];
    for (const request of requests) {
      if (request.url === null) {
        batch.done(true);
        continue;
      }

      const ref =
        previous.get(request.id) ??
        acquireTexture(request.url, request.slot === "reflection" ? "cube" : "flat");
      next.set(request.id, ref);
      if (ref.texture === null) {
        queue.push({ request, ref });
        continue;
      }

      place(request.key, request.slot, ref.texture);
      batch.done();
    }

    for (const [id, ref] of previous) {
      if (!next.has(id)) ref.release();
    }
    refs.current = next;

    const publish = () => {
      const settled = keepUnchanged(bundles, shown.current);
      shown.current = settled;
      setTextures(settled);
    };
    publish();

    let at = 0;
    let running = 0;
    const concurrency = minWidth === undefined ? Infinity : 2;

    function pump() {
      while (live && running < concurrency && at < queue.length) {
        const { request, ref } = queue[at]!;
        at += 1;
        running += 1;
        void ref.load().then((texture) => {
          running -= 1;
          if (!live) return;

          if (texture !== null) {
            place(request.key, request.slot, texture);
            publish();
          }
          batch.done(texture === null);
          queueMicrotask(pump);
        });
      }
    }

    pump();

    return () => {
      live = false;
      batch.cancel();
    };
  }, [wanted.signature, report, minWidth]);

  useEffect(() => {
    const acquired = refs;
    return () => {
      for (const ref of acquired.current.values()) ref.release();
      acquired.current = new Map();
      shown.current = EMPTY;
    };
  }, []);

  return textures;
}

/**
 * `next` with every bundle that has the same textures as `shown` swapped for the shown
 * object, so a draw memoised on its samplers keeps its material.
 */
function keepUnchanged(
  next: ReadonlyMap<string, EmitterSamplers>,
  shown: VfxTextures,
): VfxTextures {
  const out = new Map<string, EmitterSamplers>();
  for (const [key, bundle] of next) {
    const current = shown.get(key);
    out.set(key, current !== undefined && samplersEquals(current, bundle) ? current : bundle);
  }
  return out;
}

function samplersEquals(a: EmitterSamplers, b: EmitterSamplers): boolean {
  return (
    a.base === b.base &&
    a.mult === b.mult &&
    a.color === b.color &&
    a.palette === b.palette &&
    a.erosion === b.erosion &&
    a.normal === b.normal &&
    a.reflection === b.reflection
  );
}
