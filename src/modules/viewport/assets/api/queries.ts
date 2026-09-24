import { queryOptions, skipToken } from "@tanstack/react-query";

import { previewBufferUrl, type PreviewForm } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";

import { readClipBuffer } from "../parsing/clipBuffer";
import { readLightGridBuffer } from "../parsing/lightGridBuffer";
import { readMapBuffer } from "../parsing/mapBuffer";
import { readMeshBuffer } from "../parsing/meshBuffer";
import { readSkeletonBuffer } from "../parsing/skeletonBuffer";

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
  /* Its own entry rather than a `mesh` of another form, because a map is tens of MiB and
     must not share a cache key with anything a character preview evicts. */
  map: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "map", asset],
      queryFn:
        asset === null ? skipToken : async () => readMapBuffer(await fetchBuffer(asset, "map")),
      staleTime: Infinity,
      structuralSharing: false,
      retry: false,
    }),
  lightGrid: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "lightGrid", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => readLightGridBuffer(await fetchBuffer(asset, "lightgrid")),
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
