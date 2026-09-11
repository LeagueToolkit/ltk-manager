import { CAMERA, openingLook } from "./cameraPresets";
import { drawnRanges, type MeshGeometry } from "./meshBuffer";
import { AXIS_SIGN } from "./world";

type Point = readonly [number, number, number];

/** A box in the scene, by its two opposite corners. */
export interface Bounds {
  readonly min: Point;
  readonly max: Point;
}

/** Where a camera stands and what it looks at. */
export interface Framing {
  readonly target: Point;
  readonly position: Point;
}

/** The same, and the zoom an orthographic camera holds its box at. */
export interface OrthographicFraming extends Framing {
  /** Pixels of canvas per engine unit, which is the frustum ThreeJS sizes to the canvas. */
  readonly zoom: number;
}

/** How much room a frame leaves around what it holds. */
const MARGIN = 1.15;

/** How far a frame stands an orthographic camera off its box, in radii of the box. */
const STAND_OFF = 4;

/**
 * The box the drawn part of `mesh` fills at `scale`, and null where it draws no vertex.
 *
 * A submesh `hidden` names is left out, and the box crosses the mirrored axis of world.ts
 * as the character does, so a frame holds what is on screen.
 */
export function meshBounds(
  mesh: MeshGeometry,
  hidden: readonly string[],
  scale: number,
): Bounds | null {
  const { positions, indices } = mesh;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let drawn = false;
  for (const range of drawnRanges(mesh, hidden)) {
    for (let at = range.startIndex; at < range.startIndex + range.indexCount; at += 1) {
      const vertex = indices[at] * 3;
      if (vertex + 2 >= positions.length) continue;
      drawn = true;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[vertex + axis];
        if (value < min[axis]) min[axis] = value;
        if (value > max[axis]) max[axis] = value;
      }
    }
  }
  if (!drawn) return null;

  const across = (axis: number) => {
    const a = min[axis] * AXIS_SIGN[axis] * scale;
    const b = max[axis] * AXIS_SIGN[axis] * scale;
    return [Math.min(a, b), Math.max(a, b)] as const;
  };
  const [x, y, z] = [across(0), across(1), across(2)];
  return { min: [x[0], y[0], z[0]], max: [x[1], y[1], z[1]] };
}

/**
 * The camera that holds `bounds` in view, lying `direction` from what it holds.
 *
 * The box's bounding sphere fits the narrower of the two fields of view, so a tall
 * character in a narrow pane is held whole. `fov` is the vertical field in degrees, and
 * `direction` defaults to where the scene's camera opens.
 */
export function framing(
  bounds: Bounds,
  fov: number,
  aspect: number,
  direction: Point = openingLook(),
): Framing {
  const target = middle(bounds);
  const radius = radiusOf(bounds);

  const vertical = (fov * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * MARGIN;

  return { target, position: along(target, direction, distance) };
}

/**
 * The camera and the zoom that hold `bounds` in an orthographic projection.
 *
 * `width` and `height` are the canvas's own pixels, which is the frustum ThreeJS gives
 * an orthographic camera, so the zoom is what turns an engine unit into a pixel of it.
 * The stand-off holds the whole box in front of the near plane and carries no framing of
 * its own, the zoom being what frames the box.
 */
export function orthographicFraming(
  bounds: Bounds,
  width: number,
  height: number,
  direction: Point = openingLook(),
): OrthographicFraming {
  const target = middle(bounds);
  const radius = radiusOf(bounds);
  const across = Math.min(width, height);

  return {
    target,
    position: along(target, direction, Math.min(radius * STAND_OFF, CAMERA.far / 2)),
    zoom: across > 0 ? across / (2 * radius * MARGIN) : 1,
  };
}

/**
 * How far a perspective camera of `fov` stands to show what an orthographic one shows at `zoom`.
 *
 * `zoom` is pixels of a canvas `height` tall per engine unit, and `fov` the vertical field
 * in degrees, so the two projections hand the same height of the scene across a swap.
 */
export function reachOfZoom(zoom: number, height: number, fov: number): number {
  return height / zoom / (2 * Math.tan((fov * Math.PI) / 360));
}

/** The zoom an orthographic camera holds to show what a perspective one shows at `reach`. */
export function zoomOfReach(reach: number, height: number, fov: number): number {
  if (height <= 0) return 1;
  return height / (2 * reach * Math.tan((fov * Math.PI) / 360));
}

/** The middle of the box. */
function middle(bounds: Bounds): Point {
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}

/** The box's bounding sphere, and one unit for a box with no width at all. */
function radiusOf(bounds: Bounds): number {
  return (
    Math.hypot(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ) / 2 || 1
  );
}

/** `distance` from `target` along `direction`, whatever length `direction` was given at. */
function along(target: Point, direction: Point, distance: number): Point {
  const reach = Math.hypot(direction[0], direction[1], direction[2]) || 1;
  return [
    target[0] + (direction[0] / reach) * distance,
    target[1] + (direction[1] / reach) * distance,
    target[2] + (direction[2] / reach) * distance,
  ];
}
