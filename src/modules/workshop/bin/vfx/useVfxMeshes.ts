import { useEffect, useState } from "react";
import { BufferAttribute, BufferGeometry } from "three";

import { previewBufferUrl } from "@/lib/previewUrl";
import { AXIS_SIGN, type MeshGeometry, readMeshBuffer } from "@/modules/viewport";

import { type MeshBuffers, meshBuffers } from "./buffers";
import type { DrawnEmitter } from "./definitions";
import type { MeshModel } from "./model";
import { drawnIndices } from "./submeshes";

/** One geometry per drawn emitter that resolved a mesh, by the drawn emitter's key. */
export type EmitterMeshes = ReadonlyMap<string, MeshBuffers>;

const NONE: EmitterMeshes = new Map();

/**
 * The mesh each mesh emitter draws, off the same scheme its textures come from.
 *
 * The bytes never cross the JavaScript heap as anything but the one buffer, and the
 * decode is the viewport's `meshBuffer.ts` rather than a parser of its own (decision 2.2
 * of docs/plans/vfx-particle-renderer.md).
 */
export function useVfxMeshes(drawn: readonly DrawnEmitter[]): EmitterMeshes {
  const [meshes, setMeshes] = useState<EmitterMeshes>(NONE);

  useEffect(() => {
    if (drawn.length === 0) {
      setMeshes(NONE);
      return;
    }

    let live = true;
    const loaded = new Map<string, MeshBuffers>();

    for (const { key, emitter } of drawn) {
      if (emitter.mesh === null) continue;
      const mesh = emitter.mesh;

      void fetch(previewBufferUrl(mesh.asset, "geometry"))
        .then((answer) => (answer.ok ? answer.arrayBuffer() : null))
        .then((bytes) => {
          if (!live || bytes === null) return;
          loaded.set(key, meshBuffers(geometryOf(readMeshBuffer(bytes), mesh)));
          setMeshes(new Map(loaded));
        })
        .catch(() => {});
    }

    return () => {
      live = false;
      for (const held of loaded.values()) held.geometry.dispose();
      setMeshes(NONE);
    };
  }, [drawn]);

  return meshes;
}

/**
 * One decoded mesh as the geometry an instanced draw takes.
 *
 * The file holds the engine's space, as the character's `.skn` does, and the instance's
 * turn is the engine's conjugated across the mirrored axis of world.ts. So the vertices
 * cross that axis here and each face's winding turns back with them, decision 2.40 of
 * docs/plans/vfx-particle-renderer.md. A `.scb` carries no normals, so the geometry
 * computes its own where the file holds none.
 */
export function geometryOf(mesh: MeshGeometry, model: MeshModel): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mirrored(mesh.positions), 3));
  if (mesh.uvs !== null) geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
  const indices = rewound(drawnIndices(mesh, model.submeshes, model.submeshesAlways));
  geometry.setIndex(new BufferAttribute(indices, 1));

  if (mesh.normals === null) geometry.computeVertexNormals();
  else geometry.setAttribute("normal", new BufferAttribute(mirrored(mesh.normals), 3));

  geometry.computeBoundingSphere();
  return geometry;
}

/** A block of three per vertex across the mirrored axis, as a copy. */
function mirrored(block: Float32Array): Float32Array {
  return block.map((value, at) => value * AXIS_SIGN[at % 3]);
}

/** Each triangle's last two corners swapped, as a copy, which the mirror turns inside out. */
function rewound(indices: Uint32Array): Uint32Array {
  const out = indices.slice();
  for (let at = 0; at + 2 < out.length; at += 3) {
    out[at + 1] = indices[at + 2];
    out[at + 2] = indices[at + 1];
  }
  return out;
}
