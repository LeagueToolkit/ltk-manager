/**
 * The geometry buffer the `ltk-asset` scheme answers `?as=geometry` with.
 *
 * The layout is `crates/ltk-manager-core/src/preview/mesh.rs`'s module doc, and this is
 * the other half of it.
 */

import { BufferReader } from "./bufferReader";

/** `LTKG`, the word a geometry buffer opens with. */
const MAGIC = 0x474b544c;

/** The layouts this build reads. Version 2 adds the skin block under its own flag. */
const VERSIONS: readonly number[] = [1, 2];

/** What the flags word says the buffer carries past its positions. */
const FLAG = { normals: 1, uvs: 2, skin: 4 } as const;

/** One run of the index buffer, which is what a submesh filter names. */
export interface MeshRange {
  readonly name: string;
  readonly startIndex: number;
  readonly indexCount: number;
}

/** One mesh, in the file's own space and units. */
export interface MeshGeometry {
  /** Three per vertex. */
  readonly positions: Float32Array;
  /** Three per vertex, and null for a format that carries none. */
  readonly normals: Float32Array | null;
  /** Two per vertex, and null for a format that carries none. */
  readonly uvs: Float32Array | null;
  /** Four shader joints per vertex, and null for a mesh no skeleton poses. */
  readonly skinIndices: Uint8Array | null;
  /** Four weights per vertex, beside `skinIndices`. */
  readonly skinWeights: Float32Array | null;
  readonly indices: Uint32Array;
  /** The submeshes, in the order the file holds them. */
  readonly ranges: readonly MeshRange[];
}

/**
 * The runs of `mesh`'s index buffer a character draws, without the submeshes `hidden` names.
 *
 * `hidden` is matched without regard to case. A file whose ranges draw nothing, as a v0
 * `.skn` through `ltk_mesh` does, still draws its whole index block.
 */
export function drawnRanges(mesh: MeshGeometry, hidden: readonly string[]): MeshRange[] {
  if (mesh.ranges.length === 0) {
    return [{ name: "", startIndex: 0, indexCount: mesh.indices.length }];
  }
  const skip = new Set(hidden.map((name) => name.toLowerCase()));
  return mesh.ranges.filter(
    (range) =>
      !skip.has(range.name.toLowerCase()) &&
      range.startIndex + range.indexCount <= mesh.indices.length,
  );
}

/**
 * One mesh out of the bytes the scheme answered.
 *
 * # Throws
 *
 * [`BufferError`] where the bytes are not a geometry buffer of a version this build
 * reads, or where the counts reach past the bytes that arrived.
 */
export function readMeshBuffer(bytes: ArrayBuffer): MeshGeometry {
  const reader = new BufferReader(bytes);
  reader.header(MAGIC, VERSIONS, "geometry");

  const flags = reader.u32();
  const vertexCount = reader.u32();
  const indexCount = reader.u32();
  const rangeCount = reader.u32();

  const positions = reader.floats(vertexCount * 3);
  const normals = (flags & FLAG.normals) !== 0 ? reader.floats(vertexCount * 3) : null;
  const uvs = (flags & FLAG.uvs) !== 0 ? reader.floats(vertexCount * 2) : null;
  const skinned = (flags & FLAG.skin) !== 0;
  const skinIndices = skinned ? reader.bytes(vertexCount * 4) : null;
  const skinWeights = skinned ? reader.floats(vertexCount * 4) : null;
  const indices = reader.words(indexCount);

  const ranges: MeshRange[] = [];
  for (let at = 0; at < rangeCount; at += 1) {
    ranges.push({ name: reader.text(), startIndex: reader.u32(), indexCount: reader.u32() });
  }

  return { positions, normals, uvs, skinIndices, skinWeights, indices, ranges };
}
