import type { PropertyEdit, ValueEdit } from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";
import { placeablePath } from "./mapOutline";
import type { PlaceableRef } from "./placeableEdits";

/** `RegionBoundary.Vertices`, a `list2[vec3]` local to the region's transform. */
export const VERTICES = nameHash("Vertices");

/** The fewest vertices a polygon keeps, under which a removal is refused. */
export const LEAST_VERTICES = 3;

/** One vertex of a region in the engine's space, local to the region's transform. */
export type Vertex = readonly [number, number, number];

function verticesEdit(ref: PlaceableRef, edits: ValueEdit[]): PropertyEdit[] {
  return [{ entry: ref.chunk, holder: placeablePath(ref.key), field: VERTICES, edits }];
}

/** Returns the edit that moves the vertex at `index` of the region `ref` to `vertex`. */
export function moveVertexEdits(ref: PlaceableRef, index: number, vertex: Vertex): PropertyEdit[] {
  return verticesEdit(ref, [
    { type: "setLeaf", path: `[${index}]`, value: { type: "vector", values: [...vertex] } },
  ]);
}

/** Returns the edits that insert `vertex` at `index` of the region `ref`, before the vertex there. */
export function insertVertexEdits(
  ref: PlaceableRef,
  index: number,
  vertex: Vertex,
): PropertyEdit[] {
  return verticesEdit(ref, [
    { type: "insertItem", path: "", item: { index, key: null, class: null } },
    { type: "setLeaf", path: `[${index}]`, value: { type: "vector", values: [...vertex] } },
  ]);
}

/** Returns the edit that removes the vertex at `index` of the region `ref`. */
export function removeVertexEdits(ref: PlaceableRef, index: number): PropertyEdit[] {
  return verticesEdit(ref, [{ type: "removeItem", path: `[${index}]` }]);
}
