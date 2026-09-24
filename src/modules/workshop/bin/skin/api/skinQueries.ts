import { queryOptions, skipToken } from "@tanstack/react-query";

import {
  type AnimationGraph,
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type ClipHeader,
  type MaterialProgram,
  type PassProgram,
  type SkinModel,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/** The reads a skin viewport draws from, keyed on the document as `vfxKeys.system` is. */
export const skinQueries = {
  /** One skin object as a viewport draws it. */
  skin: (document: BinDocumentId, entry: string) =>
    queryOptions<SkinModel, AppError>({
      queryKey: ["skin", document, entry],
      queryFn: async () => unwrapForQuery(await api.bin.readSkin(document, entry)),
      staleTime: Infinity,
      retry: false,
    }),
  /**
   * The materials `entries` name with the game's own shaders translated, one for one,
   * and nothing where the skin names no material.
   */
  programs: (document: BinDocumentId, entries: readonly string[]) =>
    queryOptions<(MaterialProgram | null)[], AppError>({
      queryKey: ["skin-programs", document, entries],
      queryFn:
        entries.length === 0
          ? skipToken
          : async () =>
              unwrapForQuery(
                await api.bin.readMaterialPrograms({ kind: "document", document }, entries, {
                  lowQuality: false,
                }),
              ),
      staleTime: Infinity,
      retry: false,
    }),
  /**
   * The engine's default program for a submesh its skin names no material for, read
   * through `document`, and nothing for a null document.
   */
  defaultProgram: (document: BinDocumentId | null) =>
    queryOptions<PassProgram, AppError>({
      queryKey: ["skin-default-program", document],
      queryFn:
        document === null
          ? skipToken
          : async () =>
              unwrapForQuery(
                await api.bin.readDefaultSkinnedProgram(document, { lowQuality: false }),
              ),
      staleTime: Infinity,
      retry: false,
    }),
  /** One animation graph with its maps, and nothing where either is not known yet. */
  graph: (document: BinDocumentId | null, graph: string | null) =>
    queryOptions<AnimationGraph, AppError>({
      queryKey: ["skin-graph", document, graph],
      queryFn:
        document === null || graph === null
          ? skipToken
          : async () => unwrapForQuery(await api.bin.readAnimationGraph(document, graph)),
      staleTime: Infinity,
      retry: false,
    }),
  /** The rate and the length of one `.anm`, and nothing for a clip nothing holds. */
  clipHeader: (asset: AssetRef | null) =>
    queryOptions<ClipHeader, AppError>({
      queryKey: ["skin-clip-header", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => unwrapForQuery(await api.bin.readClipHeader(asset)),
      staleTime: Infinity,
      retry: false,
    }),
};
