import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { NoColorSpace, type Texture } from "three";

import type { AppError, AssetRef, BinDocumentId, MaterialProgram, SkinModel } from "@/lib/tauri";
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
import { type MaterialRead, materialReads, programsOf } from "../utils/skinScene";

/** Program textures load without colour decoding. The game's shader decodes them. */
const RAW_TEXTURES = { colorSpace: NoColorSpace } as const;

/** The program reads made while the shaders are off, which read nothing. */
const NO_READS: readonly MaterialRead[] = [];

const NO_ASSETS: ReadonlyMap<string, AssetRef> = new Map();

const NO_PASSES: readonly SubmeshProgram[] = [];

/** Every material the reads answered, the skin's own and each linked file's in one list. */
function joined(
  results: UseQueryResult<(MaterialProgram | null)[], AppError>[],
): (MaterialProgram | null)[] {
  return results.flatMap((result) => result.data ?? []);
}

/**
 * The translated passes of each submesh of `skin`, read from `document`, in draw order.
 *
 * A submesh with a material draws with every pass of its material that translated, read
 * from the file declaring the material, and a submesh without one with the engine's default
 * program. The answer is empty for every submesh while `shaders` is off.
 */
export function useSkinPrograms(
  document: BinDocumentId,
  skin: SkinModel,
  shaders: boolean,
): (submesh: string) => readonly SubmeshProgram[] {
  const reads = useMemo(() => (shaders ? materialReads(skin) : NO_READS), [shaders, skin]);
  const programs = useQueries({
    queries: reads.map((read) => skinQueries.programs(document, read.hashes, read.source)),
    combine: joined,
  });
  const assets = useMemo(() => programTextureAssets(programs), [programs]);
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
      if (!shaders) return NO_PASSES;

      const passes = programsOf(skin, programs, textures, submesh);
      if (passes.length > 0) return passes;

      const standIn = defaultProgramOf(skin, fallback, fallbackTextures, submesh);
      return standIn === null ? NO_PASSES : [standIn];
    },
    [shaders, skin, programs, textures, fallback, fallbackTextures],
  );
}

/** `textures` with a black emissive mask where the skin names no emissive texture. */
function withEmission(textures: ReadonlyMap<string, Texture>): ReadonlyMap<string, Texture> {
  if (textures.has(EMISSIVE_KEY)) return textures;
  return new Map([...textures, [EMISSIVE_KEY, blackTexel()]]);
}
