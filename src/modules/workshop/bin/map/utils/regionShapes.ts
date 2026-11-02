import { Vector3 } from "three";

import type { MapItemShape } from "@/lib/tauri";
import { AXIS_SIGN } from "@/modules/viewport";

import { viewportMatrix } from "./placeableSpace";

/** A region's polygon as the viewport draws it: its vertices placed, and the rise of its walls. */
export interface PlacedRegion {
  /** The vertices in the viewport's space, under the region's transform. */
  readonly base: readonly Vector3[];
  /** From a base vertex to the top of the wall over it: the region's up, `DrawHeight` long. */
  readonly lift: Vector3;
}

type Region = Extract<MapItemShape, { type: "region" }>;

/** A point of the engine's space in the viewport's. */
function mirrored([x, y, z]: readonly (number | null)[]): Vector3 {
  return new Vector3((x ?? 0) * AXIS_SIGN[0], (y ?? 0) * AXIS_SIGN[1], (z ?? 0) * AXIS_SIGN[2]);
}

/**
 * Returns `points`, local to the region, placed in the viewport's space under `transform`,
 * with the walls `height` units tall along the region's own Y axis.
 */
export function placeRegion(
  points: readonly (readonly (number | null)[])[],
  height: number,
  transform: readonly (number | null)[],
): PlacedRegion {
  const placement = viewportMatrix(transform);
  return {
    base: points.map((point) => mirrored(point).applyMatrix4(placement)),
    lift: new Vector3().setFromMatrixColumn(placement, 1).multiplyScalar(height),
  };
}

/** Whether the walls of `region` rise at all. */
function walled(region: PlacedRegion): boolean {
  return region.lift.lengthSq() > 0;
}

/** The top of the wall over `point`. */
function raised(point: Vector3, lift: Vector3): Vector3 {
  return point.clone().add(lift);
}

function segment(out: number[], a: Vector3, b: Vector3) {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

/**
 * Returns the line segments of `region`: its closed base, and over a height of more than 0 the
 * closed top and an edge up from each vertex, as pairs of points, three floats each.
 */
export function regionLines(region: PlacedRegion): number[] {
  const out: number[] = [];
  const { base, lift } = region;
  const rises = walled(region);
  const count = base.length;
  for (let at = 0; at < count; at += 1) {
    const here = base[at] as Vector3;
    const next = base[(at + 1) % count] as Vector3;
    segment(out, here, next);
    if (rises) {
      segment(out, raised(here, lift), raised(next, lift));
      segment(out, here, raised(here, lift));
    }
  }
  return out;
}

/**
 * Returns the triangles of `region`'s walls, two per edge, three points each, and none for a
 * flat polygon.
 */
export function regionWalls(region: PlacedRegion): number[] {
  const out: number[] = [];
  const { base, lift } = region;
  if (!walled(region)) return out;

  const count = base.length;
  for (let at = 0; at < count; at += 1) {
    const here = base[at] as Vector3;
    const next = base[(at + 1) % count] as Vector3;
    const hereTop = raised(here, lift);
    const nextTop = raised(next, lift);
    out.push(here.x, here.y, here.z, next.x, next.y, next.z, nextTop.x, nextTop.y, nextTop.z);
    out.push(
      here.x,
      here.y,
      here.z,
      nextTop.x,
      nextTop.y,
      nextTop.z,
      hereTop.x,
      hereTop.y,
      hereTop.z,
    );
  }
  return out;
}

/** The region of a placeable's shape, and null for a shape that is no polygon. */
export function regionOf(
  shape: MapItemShape | null,
  transform: readonly (number | null)[],
): { placed: PlacedRegion; region: Region | null } | null {
  if (shape === null) return null;
  if (shape.type === "region") {
    return { placed: placeRegion(shape.points, shape.height ?? 0, transform), region: shape };
  }
  if (shape.type === "polygon") {
    return { placed: placeRegion(shape.points, 0, transform), region: null };
  }
  return null;
}

/**
 * Returns the point of the viewport's space `point` as the region's own local vertex, in the
 * engine's space, under `transform`.
 */
export function localVertex(
  point: Vector3,
  transform: readonly (number | null)[],
): [number, number, number] {
  const local = point.clone().applyMatrix4(viewportMatrix(transform).invert());
  return [local.x * AXIS_SIGN[0], local.y * AXIS_SIGN[1], local.z * AXIS_SIGN[2]];
}
