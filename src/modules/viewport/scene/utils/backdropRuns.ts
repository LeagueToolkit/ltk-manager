import type {
  BufferGeometry,
  Box3,
  Frustum,
  Material,
  Matrix4,
  RawShaderMaterial,
  Vector3,
} from "three";

import type { MaterialPreview } from "@/lib/tauri";

import type { MapGeometry } from "../../assets/parsing/mapBuffer";
import type { OrderedGroup } from "./sharedRenderer";

/** One run of the index block and the index of the material that draws it. */
export interface DrawGroup {
  readonly startIndex: number;
  readonly indexCount: number;
  readonly material: number;
}

/** The draw groups of one map mesh, and the box that holds its vertices. */
export interface MeshRun {
  /** The index of the mesh in the map's mesh list. */
  readonly mesh: number;
  /** The bounds of the mesh in the space of the map's geometry. */
  readonly box: Box3;
  readonly groups: readonly DrawGroup[];
  /** The distance from the eye to `box` at the last [`runsInView`] call. Scratch, not state. */
  depth: number;
}

/**
 * The runs of `runs` whose box is in `frustum`, nearest to `eye` first, written into `out`.
 *
 * `frustum` and `eye` are in the space of the map's geometry. Drawing the nearest mesh
 * first lets the depth test reject the pixels of the meshes behind it before they are
 * shaded. Runs at the same distance keep their order in `runs`.
 */
export function runsInView(
  runs: readonly MeshRun[],
  frustum: Frustum,
  eye: Vector3,
  out: MeshRun[],
): MeshRun[] {
  out.length = 0;
  for (const run of runs) {
    if (!frustum.intersectsBox(run.box)) continue;

    run.depth = run.box.distanceToPoint(eye);
    out.push(run);
  }
  return out.sort(nearestFirst);
}

function nearestFirst(left: MeshRun, right: MeshRun): number {
  return left.depth - right.depth;
}

/** The meshes of a backdrop that a gizmo drag moves, and the change that the drag makes. */
export interface MeshDrag {
  /** The map buffer that `delta` applies to. A backdrop that draws another buffer ignores the drag. */
  readonly map: MapGeometry;
  /** The indices of the dragged meshes. A new set rewrites the draw groups, so a drag keeps one set. */
  readonly meshes: ReadonlySet<number>;
  /** The change from the transforms that `map` holds to the dragged ones, in the engine's space. */
  readonly delta: Matrix4;
}

/** The runs of a backdrop, split by whether a drag moves their mesh. */
export interface SplitRuns {
  /** The runs of the meshes that stay in place, in the order of the given runs. */
  readonly fixed: readonly MeshRun[];
  /** The runs of the dragged meshes, in the order of the given runs. */
  readonly dragged: readonly MeshRun[];
}

const NO_RUNS: readonly MeshRun[] = [];

/**
 * Splits `runs` by whether `dragged` holds the mesh of each run.
 *
 * Returns `runs` itself as the fixed part if `dragged` is null or empty, so the groups written
 * outside a drag keep their identity.
 */
export function splitRuns(
  runs: readonly MeshRun[],
  dragged: ReadonlySet<number> | null,
): SplitRuns {
  if (dragged === null || dragged.size === 0) return { fixed: runs, dragged: NO_RUNS };

  const fixed: MeshRun[] = [];
  const moved: MeshRun[] = [];
  for (const run of runs) {
    if (dragged.has(run.mesh)) moved.push(run);
    else fixed.push(run);
  }
  return { fixed, dragged: moved };
}

/**
 * The tier that a blended surface of the backdrop is drawn in, lowest first.
 *
 * - `0`: writes depth and has no alpha test and no opacity, which the fallback path draws
 *   opaque, such as a blended ground layer
 * - `1`: writes depth and has an alpha test or an opacity, such as a ground decal
 * - `2`: writes no depth, such as water, glass or an additive effect
 */
export type BlendTier = 0 | 1 | 2;

/** The pass state that [`blendTierOf`] reads. */
export interface BlendState {
  readonly depthWrite: boolean;
  /** The alpha a fragment is discarded below, and null for none. */
  readonly alphaTest: number | null;
  readonly opacity: number | null;
}

/**
 * Returns the [`BlendTier`] of a blended surface with `state`.
 *
 * An alpha test of 0 or below counts as none. A surface that writes no depth is in tier 2
 * whatever its alpha test.
 */
export function blendTierOf(state: BlendState): BlendTier {
  if (!state.depthWrite) return 2;

  const reads = (state.alphaTest ?? 0) > 0 || state.opacity !== null;
  return reads ? 1 : 0;
}

/**
 * Returns the [`BlendTier`] of a backdrop surface drawn with `material` for `slots`.
 *
 * A translated program writes depth as its pass does, and a stock material as its slots do.
 * A surface without slots writes depth.
 */
export function surfaceBlendTier({
  material,
  slots,
}: {
  readonly material: Material;
  readonly slots: MaterialPreview | null;
}): BlendTier {
  const program = (material as RawShaderMaterial).isRawShaderMaterial === true;
  return blendTierOf({
    depthWrite: program ? material.depthWrite : (slots?.renderState.depthWrite ?? true),
    alphaTest: slots?.alphaTest ?? null,
    opacity: slots?.opacity ?? null,
  });
}

/**
 * Points `geometry`'s groups at the draw groups of `runs`, in order, each with its place
 * in the list and the tier of its material in `tiers`, and marks the write with a new
 * `userData.written` token.
 *
 * A material that `tiers` has no entry for takes tier 0. The group objects of the geometry
 * are reused, so a write each frame allocates nothing once the list has reached its longest.
 */
export function writeGroups(
  geometry: BufferGeometry,
  runs: readonly MeshRun[],
  tiers: readonly BlendTier[] = [],
): void {
  const groups: OrderedGroup[] = geometry.groups;
  let count = 0;

  for (const run of runs) {
    for (const group of run.groups) {
      const slot = groups[count];
      const tier = tiers[group.material] ?? 0;
      if (slot === undefined) {
        groups.push({
          start: group.startIndex,
          count: group.indexCount,
          materialIndex: group.material,
          order: count,
          tier,
        });
      } else {
        slot.start = group.startIndex;
        slot.count = group.indexCount;
        slot.materialIndex = group.material;
        slot.order = count;
        slot.tier = tier;
      }
      count += 1;
    }
  }
  groups.length = count;
  geometry.userData.written = {};
}
