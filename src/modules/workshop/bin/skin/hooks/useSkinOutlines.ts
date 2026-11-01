import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { NoColorSpace } from "three";

import type { AssetRef, BinDocumentId, MaterialProgram, SkinModel } from "@/lib/tauri";
import { programTextureAssets, type SubmeshOutline, useAssetTextures } from "@/modules/viewport";
import { usePreviewOutlines } from "@/stores";

import { skinQueries } from "../api/skinQueries";
import { outlineMaskAssets, outlineMaterialHashes, submeshOutline } from "../utils/skinScene";

/** Masks and program textures load without colour decoding. */
const RAW_TEXTURES = { colorSpace: NoColorSpace, holdWhileLoading: true } as const;

/** The outline materials read while the shaders are off, which is none. */
const NO_HASHES: readonly string[] = [];

const NO_PROGRAMS: readonly (MaterialProgram | null)[] = [];

const NO_MASKS: ReadonlyMap<string, AssetRef> = new Map();

/**
 * The outline each submesh of `skin` draws, read from `document`, and null for none.
 *
 * While `shaders` is on, an outline draws with its material's translated pass, and an outline
 * whose pass did not translate draws the stock outline material, as every outline does while
 * `shaders` is off. Every submesh answers null while the outline display setting is off.
 */
export function useSkinOutlines(
  document: BinDocumentId,
  skin: SkinModel,
  shaders: boolean,
): (submesh: string) => SubmeshOutline | null {
  const shown = usePreviewOutlines();
  const hashes = useMemo(
    () => (shown && shaders ? outlineMaterialHashes(skin) : NO_HASHES),
    [shown, shaders, skin],
  );
  const programs = useQuery(skinQueries.programs(document, hashes)).data ?? NO_PROGRAMS;
  const programAssets = useMemo(() => programTextureAssets(programs), [programs]);
  const textures = useAssetTextures(programAssets, RAW_TEXTURES);
  const maskAssets = useMemo(() => (shown ? outlineMaskAssets(skin) : NO_MASKS), [shown, skin]);
  const masks = useAssetTextures(maskAssets, RAW_TEXTURES);

  return useCallback(
    (submesh: string) => (shown ? submeshOutline(skin, programs, textures, masks, submesh) : null),
    [shown, skin, programs, textures, masks],
  );
}
