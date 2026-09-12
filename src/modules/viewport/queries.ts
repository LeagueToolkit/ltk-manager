import { queryOptions, skipToken } from "@tanstack/react-query";

import { previewBufferUrl, type PreviewForm } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";

import { readClipBuffer } from "./clipBuffer";
import { readMeshBuffer } from "./meshBuffer";
import { readSkeletonBuffer } from "./skeletonBuffer";

/** The bytes of `asset`'s buffer of `form`, or the backend's own words for why not. */
async function fetchBuffer(asset: AssetRef, form: PreviewForm): Promise<ArrayBuffer> {
  const answer = await fetch(previewBufferUrl(asset, form));
  if (!answer.ok) throw new Error(await answer.text());
  return answer.arrayBuffer();
}

/**
 * The buffers a viewport draws from, each decoded once per asset.
 *
 * A null asset asks for nothing. The decoded arrays are kept as they arrived, because
 * comparing two of them for sharing is a walk over every vertex.
 */
export const viewportQueries = {
  mesh: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "mesh", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => readMeshBuffer(await fetchBuffer(asset, "geometry")),
      staleTime: Infinity,
      structuralSharing: false,
      retry: false,
    }),
  skeleton: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "skeleton", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => readSkeletonBuffer(await fetchBuffer(asset, "skeleton")),
      staleTime: Infinity,
      structuralSharing: false,
      retry: false,
    }),
  clip: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "clip", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => readClipBuffer(await fetchBuffer(asset, "animation")),
      staleTime: Infinity,
      structuralSharing: false,
      retry: false,
    }),
};
