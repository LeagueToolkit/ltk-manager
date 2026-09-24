import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { NoColorSpace, type Texture } from "three";

import type { AssetRef, BinDocumentId, SkinModel } from "@/lib/tauri";
import {
  blackTexel,
  programTextureAssets,
  type SubmeshProgram,
  useAssetTextures,
} from "@/modules/viewport";

import { skinQueries } from "../api/skinQueries";
import {
  defaultProgramAssets,
  defaultProgramOf,
  drawsDefaultProgram,
  EMISSIVE_KEY,
} from "../utils/defaultProgram";
import { materialHashes, programOf } from "../utils/skinScene";

/** Program textures load without colour decoding. The game's shader decodes them. */
const RAW_TEXTURES = { colorSpace: NoColorSpace } as const;

/** The material list of the program read while the shaders are off, which reads nothing. */
const NO_MATERIALS: readonly string[] = [];

const NO_ASSETS: ReadonlyMap<string, AssetRef> = new Map();

/**
 * The translated program of each submesh of `skin`, read from `document`.
 *
 * A submesh with a material draws with the material's program, and a submesh without one
 * with the engine's default program. The answer is null for every submesh
 * while `shaders` is off.
 */
export function useSkinPrograms(
  document: BinDocumentId,
  skin: SkinModel,
  shaders: boolean,
): (submesh: string) => SubmeshProgram | null {
  const materials = useMemo(() => materialHashes(skin), [skin]);
  const programs = useQuery(skinQueries.programs(document, shaders ? materials : NO_MATERIALS));
  const assets = useMemo(() => programTextureAssets(programs.data ?? []), [programs.data]);
  const textures = useAssetTextures(assets, RAW_TEXTURES);

  const defaults = shaders && drawsDefaultProgram(skin);
  const fallback = useQuery(skinQueries.defaultProgram(defaults ? document : null)).data ?? null;
  const fallbackAssets = useMemo(
    () => (defaults ? defaultProgramAssets(skin) : NO_ASSETS),
    [defaults, skin],
  );
  const loaded = useAssetTextures(fallbackAssets, RAW_TEXTURES);
  const fallbackTextures = useMemo(() => withEmission(loaded), [loaded]);

  return useCallback(
    (submesh: string) => {
      if (!shaders) return null;
      return (
        programOf(skin, programs.data ?? [], textures, submesh) ??
        defaultProgramOf(skin, fallback, fallbackTextures, submesh)
      );
    },
    [shaders, skin, programs.data, textures, fallback, fallbackTextures],
  );
}

/** `textures` with a black emissive mask where the skin names no emissive texture. */
function withEmission(textures: ReadonlyMap<string, Texture>): ReadonlyMap<string, Texture> {
  if (textures.has(EMISSIVE_KEY)) return textures;
  return new Map([...textures, [EMISSIVE_KEY, blackTexel()]]);
}
