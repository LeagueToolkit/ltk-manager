import type { MeshGeometry, MeshRange } from "@/modules/viewport";

import { nameHash } from "../binHash";

/**
 * The indices two submesh lists leave, in the file's own order.
 *
 * `draw` narrows the mesh to the submeshes it names, and naming none, or none the mesh
 * holds, leaves the whole of it. `always` adds its own on top of what `draw` leaves. Each
 * list holds hashes where a range holds a name, so the name is hashed to meet them.
 *
 * A range reaching past the index block is dropped, because `subarray` clamps to what is
 * there and would leave the rest of its run a fan through vertex zero.
 */
export function drawnIndices(
  mesh: MeshGeometry,
  draw: readonly string[],
  always: readonly string[],
): Uint32Array {
  const drawn = rangesNamed(mesh, draw);
  if (drawn.size === 0) return mesh.indices;

  for (const range of rangesNamed(mesh, always)) drawn.add(range);
  const kept = mesh.ranges.filter(
    (range) => drawn.has(range) && range.startIndex + range.indexCount <= mesh.indices.length,
  );
  const out = new Uint32Array(kept.reduce((sum, range) => sum + range.indexCount, 0));
  let at = 0;
  for (const range of kept) {
    out.set(mesh.indices.subarray(range.startIndex, range.startIndex + range.indexCount), at);
    at += range.indexCount;
  }
  return out;
}

/**
 * Which of a character's submeshes an attached mesh draws over, one flag a range.
 *
 * `draw` narrows the character as `drawnIndices` narrows a mesh, the character's own
 * `hidden` narrows that, and `always` is added after both, so a hidden cape still draws
 * its effect.
 */
export function rangesDrawn(
  ranges: readonly MeshRange[],
  hidden: readonly string[],
  draw: readonly string[],
  always: readonly string[],
): boolean[] {
  const skip = new Set(hidden.map((name) => name.toLowerCase()));
  const named = namedIn(ranges, draw);
  const narrowed = named.includes(true) ? named : ranges.map(() => true);
  const kept = namedIn(ranges, always);
  return ranges.map(
    (range, at) => (narrowed[at] && !skip.has(range.name.toLowerCase())) || kept[at],
  );
}

function namedIn(ranges: readonly MeshRange[], hashes: readonly string[]): boolean[] {
  const wanted = new Set(hashes);
  return ranges.map((range) => wanted.has(nameHash(range.name)));
}

function rangesNamed(mesh: MeshGeometry, hashes: readonly string[]): Set<MeshRange> {
  const wanted = new Set(hashes);
  return new Set(mesh.ranges.filter((range) => wanted.has(nameHash(range.name))));
}
