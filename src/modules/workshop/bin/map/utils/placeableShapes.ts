import { Vector3 } from "three";

import type { MapItemShape } from "@/lib/tauri";
import { AXIS_SIGN } from "@/modules/viewport";

import { viewportMatrix } from "./placeableSpace";

/** Segments per circle of a sphere's outline. */
const CIRCLE_SEGMENTS = 32;

/** One placeable's extent, with its `transform` column major in the engine's space. */
export interface ShapedItem {
  readonly shape: MapItemShape;
  readonly transform: readonly (number | null)[];
}

type Frustum = Extract<MapItemShape, { type: "frustum" }>;

/** Pushes the segment `a`-`b` onto `out`. */
function segment(out: number[], a: Vector3, b: Vector3) {
  out.push(a.x, a.y, a.z, b.x, b.y, b.z);
}

/** A point of the engine's space in the viewport's. */
function mirrored([x, y, z]: readonly (number | null)[]): Vector3 {
  return new Vector3((x ?? 0) * AXIS_SIGN[0], (y ?? 0) * AXIS_SIGN[1], (z ?? 0) * AXIS_SIGN[2]);
}

function sphere(out: number[], center: Vector3, radius: number) {
  for (const [u, v] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const) {
    let previous: Vector3 | null = null;
    for (let at = 0; at <= CIRCLE_SEGMENTS; at += 1) {
      const angle = (at / CIRCLE_SEGMENTS) * Math.PI * 2;
      const point = center.clone();
      point.setComponent(u, point.getComponent(u) + Math.cos(angle) * radius);
      point.setComponent(v, point.getComponent(v) + Math.sin(angle) * radius);
      if (previous !== null) segment(out, previous, point);
      previous = point;
    }
  }
}

/** The four corners of a frustum's slice at `distance` along -Z, in its own space. */
function slice(shape: Frustum, distance: number): Vector3[] {
  const halfHeight = shape.orthographic
    ? (shape.orthoHeight ?? 0) / 2
    : distance * Math.tan((((shape.fov ?? 0) / 2) * Math.PI) / 180);
  const halfWidth = halfHeight * (shape.aspect ?? 1);
  return [
    new Vector3(-halfWidth, -halfHeight, -distance),
    new Vector3(halfWidth, -halfHeight, -distance),
    new Vector3(halfWidth, halfHeight, -distance),
    new Vector3(-halfWidth, halfHeight, -distance),
  ];
}

function frustum(out: number[], shape: Frustum, transform: readonly (number | null)[]) {
  const placement = viewportMatrix(transform);
  const near = slice(shape, shape.near ?? 0).map((point) => point.applyMatrix4(placement));
  const far = slice(shape, shape.far ?? 0).map((point) => point.applyMatrix4(placement));
  const origin = new Vector3().applyMatrix4(placement);

  for (let at = 0; at < 4; at += 1) {
    const next = (at + 1) % 4;
    segment(out, near[at] as Vector3, near[next] as Vector3);
    segment(out, far[at] as Vector3, far[next] as Vector3);
    segment(out, near[at] as Vector3, far[at] as Vector3);
    if (!shape.orthographic) segment(out, origin, near[at] as Vector3);
  }
}

function box(out: number[], min: readonly (number | null)[], max: readonly (number | null)[]) {
  const corners: Vector3[] = [];
  for (let at = 0; at < 8; at += 1) {
    corners.push(
      mirrored([
        (at & 1 ? max[0] : min[0]) ?? 0,
        (at & 2 ? max[1] : min[1]) ?? 0,
        (at & 4 ? max[2] : min[2]) ?? 0,
      ]),
    );
  }
  for (let at = 0; at < 8; at += 1) {
    for (const bit of [1, 2, 4]) {
      if ((at & bit) === 0) segment(out, corners[at] as Vector3, corners[at | bit] as Vector3);
    }
  }
}

/** Pushes the edges of the cube from -0.5 to 0.5 under `transform`. */
function placedBox(out: number[], transform: readonly (number | null)[]) {
  const placement = viewportMatrix(transform);
  const corners: Vector3[] = [];
  for (let at = 0; at < 8; at += 1) {
    corners.push(
      new Vector3(at & 1 ? 0.5 : -0.5, at & 2 ? 0.5 : -0.5, at & 4 ? 0.5 : -0.5).applyMatrix4(
        placement,
      ),
    );
  }
  for (let at = 0; at < 8; at += 1) {
    for (const bit of [1, 2, 4]) {
      if ((at & bit) === 0) segment(out, corners[at] as Vector3, corners[at | bit] as Vector3);
    }
  }
}

/** Pushes the closed outline of `points` under `transform`. */
function polygon(
  out: number[],
  points: readonly (readonly (number | null)[])[],
  transform: readonly (number | null)[],
) {
  const placement = viewportMatrix(transform);
  const placed = points.map((point) => mirrored(point).applyMatrix4(placement));
  placed.forEach((point, at) => segment(out, point, placed[(at + 1) % placed.length] as Vector3));
}

/**
 * Returns the line segments that outline each of `items` in the viewport's space, as pairs of
 * points, three floats each.
 *
 * A sphere is three circles around the position, a frustum its two slices and the edges
 * between them, a box its twelve edges, and a path the segments between its points. A volume
 * is the unit cube under its transform, and a polygon is closed under its transform.
 */
export function shapeLines(items: readonly ShapedItem[]): Float32Array {
  const out: number[] = [];
  for (const { shape, transform } of items) {
    switch (shape.type) {
      case "sphere":
        sphere(out, mirrored([transform[12], transform[13], transform[14]]), shape.radius ?? 0);
        break;
      case "frustum":
        frustum(out, shape, transform);
        break;
      case "box":
        box(out, shape.min, shape.max);
        break;
      case "path":
        for (let at = 1; at < shape.points.length; at += 1) {
          segment(out, mirrored(shape.points[at - 1] ?? []), mirrored(shape.points[at] ?? []));
        }
        break;
      case "volume":
        placedBox(out, transform);
        break;
      case "polygon":
        polygon(out, shape.points, transform);
        break;
      /* Drawn by `RegionBoundaries` in its own colors. */
      case "region":
        break;
    }
  }
  return new Float32Array(out);
}
