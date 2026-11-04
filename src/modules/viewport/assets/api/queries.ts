import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import { previewBufferUrl, previewFileUrl, type PreviewForm } from "@/lib/previewUrl";
import type { AssetRef } from "@/lib/tauri";

import { readColliderFile } from "../../dynamics/colliderFile";
import { readClipBuffer } from "../parsing/clipBuffer";
import { readLightGridBuffer } from "../parsing/lightGridBuffer";
import { type MapGeometry, readMapBuffer } from "../parsing/mapBuffer";
import { readMeshBuffer } from "../parsing/meshBuffer";
import { readNavGridFile } from "../parsing/navGridBuffer";
import { readSkeletonBuffer } from "../parsing/skeletonBuffer";

/** The bytes of `asset`'s buffer of `form`, or the backend's own words for why not. */
async function fetchBuffer(asset: AssetRef, form: PreviewForm): Promise<ArrayBuffer> {
  const answer = await fetch(previewBufferUrl(asset, form));
  if (!answer.ok) throw new Error(await answer.text());
  return answer.arrayBuffer();
}

/** A `.mapgeo` open for edits in the backend, and the count of its changes. */
export interface EditedGeometry {
  readonly document: number;
}

/**
 * Reads the map buffer of the `.mapgeo` open for edits under `document`, or of its meshes at
 * `meshes` alone, in that order. The map editor keeps the whole buffer up to date with the
 * changes it makes and reads only the meshes an edit adds.
 */
export async function fetchEditedMap(
  asset: AssetRef,
  document: number,
  meshes: readonly number[] | null,
): Promise<MapGeometry> {
  const narrowed = meshes === null ? "" : `&meshes=${meshes.join(",")}`;
  const answer = await fetch(`${previewBufferUrl(asset, "map")}&geometry=${document}${narrowed}`);
  if (!answer.ok) throw new Error(await answer.text());
  return readMapBuffer(await answer.arrayBuffer());
}

/** The bytes of `asset` as the file holds them. */
async function fetchFile(asset: AssetRef): Promise<ArrayBuffer> {
  const answer = await fetch(previewFileUrl(asset));
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
  /**
   * The map buffer of the `.mapgeo` open for edits under `edited.document`, read once. The map
   * editor sets each edit's result on this entry, from the deltas the edit answers.
   */
  editedMap: (asset: AssetRef | null, edited: EditedGeometry) =>
    queryOptions({
      queryKey: ["viewport", "map", asset, "edited", edited.document],
      queryFn:
        asset === null ? skipToken : async () => fetchEditedMap(asset, edited.document, null),
      staleTime: Infinity,
      gcTime: 0,
      structuralSharing: false,
      retry: false,
      placeholderData: keepPreviousData,
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
  /* A grid or an overlay, by the magic of the buffer that the one `navgrid` form answers. */
  navGrid: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "navGrid", asset],
      queryFn:
        asset === null
          ? skipToken
          : async () => readNavGridFile(await fetchBuffer(asset, "navgrid")),
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
  /* The collision shapes of a dynamics chain, which no preview form decodes. */
  colliders: (asset: AssetRef | null) =>
    queryOptions({
      queryKey: ["viewport", "colliders", asset],
      queryFn: asset === null ? skipToken : async () => readColliderFile(await fetchFile(asset)),
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
