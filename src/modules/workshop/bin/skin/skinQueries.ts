import { queryOptions, skipToken } from "@tanstack/react-query";

import {
  type AnimationClip,
  api,
  type AppError,
  type BinDocumentId,
  type SkinModel,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/** The reads a skin viewport draws from, keyed on the document as `vfxKeys.system` is. */
export const skinQueries = {
  /** One skin object as a viewport draws it. */
  skin: (document: BinDocumentId, entry: string) =>
    queryOptions<SkinModel, AppError>({
      queryKey: ["skin", document, entry],
      queryFn: async () => unwrapForQuery(await api.readSkin(document, entry)),
      staleTime: Infinity,
      retry: false,
    }),
  /** The clips of one animation graph, and nothing where either is not known yet. */
  clips: (document: BinDocumentId | null, graph: string | null) =>
    queryOptions<AnimationClip[], AppError>({
      queryKey: ["skin-clips", document, graph],
      queryFn:
        document === null || graph === null
          ? skipToken
          : async () => unwrapForQuery(await api.readAnimationClips(document, graph)),
      staleTime: Infinity,
      retry: false,
    }),
};
