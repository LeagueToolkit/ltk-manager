import { MeshBasicMaterial, SphereGeometry } from "three";

import { useDisposable } from "@/hooks";
import type { SceneColors } from "@/modules/viewport";

import type { PlacedItem } from "../utils/mapOutline";
import type { Vertex } from "../utils/regionEdits";
import { placeRegion } from "../utils/regionShapes";

/** Smaller than a vertex knob of `RegionHandles`, so a marker does not read as a handle. */
const MARKER_RADIUS = 6;

/** Drawn over the map, since the markers are chrome rather than scene. */
const OVER_THE_SCENE = 1001;

export interface RegionVertexMarkersProps {
  /** The polygon placeable whose vertices the markers stand on. */
  readonly placed: PlacedItem;
  readonly points: readonly Vertex[];
  readonly colors: SceneColors;
}

/**
 * A dot on each vertex of the lead polygon whose vertices do not drag: a region guide, a light
 * region, or a region boundary of a read-only map or under a tool other than Select and Move.
 * The dots take no pointer events. Per "Region boundaries" in docs/ux/MAP_EDITOR.md.
 */
export function RegionVertexMarkers({ placed, points, colors }: RegionVertexMarkersProps) {
  const { base } = placeRegion(points, 0, placed.item.transform);
  const geometry = useDisposable(() => new SphereGeometry(MARKER_RADIUS, 12, 8), []);
  const material = useDisposable(
    () =>
      new MeshBasicMaterial({
        color: colors.gizmo,
        depthTest: false,
        transparent: true,
        opacity: 0.7,
      }),
    [colors.gizmo],
  );

  return (
    <>
      {base.map((point, index) => (
        <mesh
          key={index}
          geometry={geometry}
          material={material}
          position={point}
          renderOrder={OVER_THE_SCENE}
        />
      ))}
    </>
  );
}
