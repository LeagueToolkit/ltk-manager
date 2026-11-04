import { useMemo } from "react";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, MeshBasicMaterial } from "three";

import { useDisposable } from "@/hooks";
import type { MapGeometryMesh } from "@/lib/tauri";
import { AXIS_SIGN, type MapGeometry, pullDepthToEye, type SceneColors } from "@/modules/viewport";

import { meshPatch } from "../utils/meshSelection";

/** Drawn over the map's own meshes, under the markers. */
const OVER_THE_MAP = 997;

const NO_DELTA = new Matrix4();

export interface MeshHighlightProps {
  /** The map buffer the backdrop draws, which the highlight copies the triangles of. */
  readonly map: MapGeometry | undefined;
  /** The selected meshes, the lead first. */
  readonly meshes: readonly MapGeometryMesh[];
  /** The change a drag makes to the meshes of `map`, in the engine's space, and null outside one. */
  readonly delta: Matrix4 | null;
  readonly colors: SceneColors;
}

/**
 * The selected meshes drawn in the selection color: a faint fill and their wireframe where they
 * show, both hidden behind whatever stands in front of them. During a drag the highlight moves by
 * `delta`, the change that the backdrop draws the dragged meshes at.
 */
export function MeshHighlight({ map, meshes, delta, colors }: MeshHighlightProps) {
  const indices = useMemo(() => meshes.map((mesh) => mesh.index), [meshes]);
  const geometry = useDisposable(() => {
    const made = new BufferGeometry();
    if (map === undefined) return made;

    const patch = meshPatch(map, indices);
    made.setAttribute("position", new BufferAttribute(patch.positions, 3));
    made.setIndex(new BufferAttribute(patch.indices, 1));
    return made;
  }, [map, indices]);

  const fill = useDisposable(
    () =>
      new MeshBasicMaterial({
        color: colors.gizmo,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    [colors.gizmo],
  );
  const wire = useDisposable(
    () =>
      pullDepthToEye(
        new MeshBasicMaterial({
          color: colors.gizmo,
          wireframe: true,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      ),
    [colors.gizmo],
  );
  if (meshes.length === 0) return null;

  return (
    <group scale={[AXIS_SIGN[0], AXIS_SIGN[1], AXIS_SIGN[2]]}>
      <group matrix={delta ?? NO_DELTA} matrixAutoUpdate={false}>
        <mesh
          geometry={geometry}
          material={fill}
          renderOrder={OVER_THE_MAP}
          frustumCulled={false}
        />
        <mesh
          geometry={geometry}
          material={wire}
          renderOrder={OVER_THE_MAP + 1}
          frustumCulled={false}
        />
      </group>
    </group>
  );
}
