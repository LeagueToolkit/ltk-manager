import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { NoColorSpace, type Texture } from "three";

import type { AssetRef, BinDocumentId, MaterialProgram, SkinModel } from "@/lib/tauri";
import {
  blackTexel,
  programTextureAssets,
  type SubmeshProgram,
  useAssetTextures,
} from "@/modules/viewport";

import { skinQueries } from "../api/skinQueries";
import {
  type DefaultPrograms,
  defaultProgramAssets,
  defaultProgramOf,
  drawsDefaultProgram,
  EMISSIVE_KEY,
} from "../utils/defaultProgram";
import { materialHashes, programsOf } from "../utils/skinScene";

/** Program textures load without colour decoding. The game's shader decodes them. */
const RAW_TEXTURES = { colorSpace: NoColorSpace, holdWhileLoading: true } as const;

/** The materials read while the shaders are off, which is none. */
const NO_HASHES: readonly string[] = [];

const NO_PROGRAMS: readonly (MaterialProgram | null)[] = [];

const NO_ASSETS: ReadonlyMap<string, AssetRef> = new Map();

const NO_PASSES: readonly SubmeshProgram[] = [];

/**
 * The translated passes of each submesh of `skin`, read from `document`, in draw order.
 *
 * A submesh with a material draws with every pass of its material that translated, and a
 * submesh without one with the engine's default program in the permutation its maps select.
 * `tangents` says whether the mesh carries the tangents a normal map's permutation reads. The
 * answer is empty for every submesh while `shaders` is off.
 */
export function useSkinPrograms(
  document: BinDocumentId,
  skin: SkinModel,
  shaders: boolean,
  tangents: boolean,
): (submesh: string) => readonly SubmeshProgram[] {
  const hashes = useMemo(() => (shaders ? materialHashes(skin) : NO_HASHES), [shaders, skin]);
  const programs = useQuery(skinQueries.programs(document, hashes)).data ?? NO_PROGRAMS;
  const assets = useMemo(() => programTextureAssets(programs), [programs]);
  const textures = useAssetTextures(assets, RAW_TEXTURES);

  const defaults = shaders && drawsDefaultProgram(skin);
  const pbr = defaults && namesAsset(skin, "roughnessMetallicAoTexture");
  const normal = pbr && tangents && namesAsset(skin, "normalMapTexture");
  const base = useQuery(skinQueries.defaultProgram(defaults ? document : null, "base")).data;
  const rma = useQuery(skinQueries.defaultProgram(pbr ? document : null, "roughnessMetallic")).data;
  const rmaNormal = useQuery(
    skinQueries.defaultProgram(normal ? document : null, "roughnessMetallicNormal"),
  ).data;
  const fallbacks = useMemo<DefaultPrograms>(
    () => ({
      base: base ?? null,
      roughnessMetallic: rma ?? null,
      roughnessMetallicNormal: rmaNormal ?? null,
    }),
    [base, rma, rmaNormal],
  );
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

      const standIn = defaultProgramOf(skin, fallbacks, fallbackTextures, submesh, tangents);
      return standIn === null ? NO_PASSES : [standIn];
    },
    [shaders, skin, programs, textures, fallbacks, fallbackTextures, tangents],
  );
}

/** Whether the skin or one of its overrides names a held texture in `field`. */
function namesAsset(
  skin: SkinModel,
  field: "roughnessMetallicAoTexture" | "normalMapTexture",
): boolean {
  return [skin, ...skin.overrides].some((owner) => Boolean(owner[field]?.asset));
}

/** `textures` with a black emissive mask where the skin names no emissive texture. */
function withEmission(textures: ReadonlyMap<string, Texture>): ReadonlyMap<string, Texture> {
  if (textures.has(EMISSIVE_KEY)) return textures;
  return new Map([...textures, [EMISSIVE_KEY, blackTexel()]]);
}
