import type { BufferGeometry, DataTexture, Texture } from "three";

import { STAGE_ORDER } from "../../shared/utils/space";
import { useNavProjection } from "../hooks/useNavProjection";
import type { NavProjection, ProjectedSurface } from "../utils/navProjection";
import { drawsNavProjection, type ViewMode } from "../utils/viewMode";

/** Drawn after every surface of the backdrop, its blended ones included, and before the scene. */
const NAV_PROJECTION_ORDER = STAGE_ORDER + 1;

export interface NavProjectionMeshProps {
  /** The backdrop's geometry, whose groups the backdrop writes for the meshes that it draws. */
  readonly geometry: BufferGeometry;
  /** The backdrop's material array entries, by the `materialIndex` of its groups. */
  readonly surfaces: readonly ProjectedSurface[];
  /** The backdrop's base textures, by material entry path. */
  readonly textures: ReadonlyMap<string, Texture>;
  readonly projection: NavProjection | null;
  /** The `R32F` height samples that the cutoff reads, shared with the conformance surface. */
  readonly heights: DataTexture | null;
  readonly viewMode: ViewMode;
}

/**
 * The navgrid projection of a backdrop: a second draw of the backdrop's geometry that tints its
 * surfaces from above. Per section 3.6 of docs/plans/navgrid-guides.md.
 *
 * The mesh shares the geometry and so its groups, so a hidden mesh, a visibility layer that is
 * off and a controller state that is not shown draw no tint. Each group takes the tint over the
 * fragments that `projectionCoverOf` returns for its surface. Draws nothing without a projection.
 */
export function NavProjectionMesh({
  geometry,
  surfaces,
  textures,
  projection,
  heights,
  viewMode,
}: NavProjectionMeshProps) {
  const materials = useNavProjection(projection, heights, surfaces, textures);

  if (materials === null) return null;

  return (
    <mesh
      geometry={geometry}
      material={materials}
      visible={drawsNavProjection(viewMode)}
      renderOrder={NAV_PROJECTION_ORDER}
      frustumCulled={false}
    />
  );
}
