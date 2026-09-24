/**
 * The primitive picker's sketch: a few particles and the geometry a primitive builds from
 * them, projected through a camera that orbits the scene.
 *
 * "The primitive" in docs/ux/BIN_EDITOR.md. Each shape follows the class's page on the meta
 * wiki: what faces the camera, what turns with the particle, what spans two endpoints.
 */

type Vec3 = readonly [number, number, number];

/** A point on the sketch, in the units of [`SKETCH_VIEW`]. */
export type SketchPoint = readonly [number, number];

/** What the sketch draws for one primitive class. */
export type SketchKind =
  | "cameraQuad"
  | "arbitraryQuad"
  | "ray"
  | "beam"
  | "segmentBeam"
  | "cameraTrail"
  | "arbitraryTrail"
  | "mesh"
  | "attachedMesh"
  | "projection"
  | "none";

/** One filled polygon, far ones first. */
export interface SketchShape {
  readonly points: readonly SketchPoint[];
  /** How strongly it is filled, 0 to 1. A solid's face fills by how squarely it meets the light. */
  readonly shade: number;
  /** A face of a solid, which hides what is behind it, where a billboard lets it through. */
  readonly solid: boolean;
}

/** A mesh's triangles, fitted to the sketch: centred above the ground at one size. */
export interface SketchMesh {
  /** Three per vertex. */
  readonly positions: Float32Array;
  /** Three per triangle. */
  readonly indices: Uint32Array;
}

/** Everything one frame of the sketch draws, in painting order within each list. */
export interface Sketch {
  readonly ground: readonly (readonly [SketchPoint, SketchPoint])[];
  readonly shapes: readonly SketchShape[];
  /** Dashed lines, such as a projection's reach to the ground. */
  readonly guides: readonly (readonly [SketchPoint, SketchPoint])[];
  /** Particles, and a beam's two endpoints. */
  readonly dots: readonly SketchPoint[];
}

/** The sketch's view box. */
export const SKETCH_VIEW = { width: 160, height: 90 } as const;

/** How far the camera sits from what it looks at, and how far above the ground it looks. */
const ORBIT = { distance: 7.5, pitch: 0.38, target: [0, 0.7, 0] as Vec3 } as const;

/** The focal length, in view units, that fits the scene's four units across the width. */
const FOCAL = 225;

const UP: Vec3 = [0, 1, 0];
const LIGHT = normalize([0.4, 1, 0.6]);

/** Three particles, and the rotation each carries for the kinds that read one. */
const PARTICLES: readonly { readonly at: Vec3; readonly turn: readonly [number, number] }[] = [
  { at: [-1.3, 0.9, 0.3], turn: [0, -Math.PI / 2] },
  { at: [0, 1.05, -0.3], turn: [Math.PI / 5, 0] },
  { at: [1.3, 0.8, 0.2], turn: [-Math.PI / 4, -Math.PI / 5] },
];

const BEAM_SOURCE: Vec3 = [-1.8, 0.6, 0.4];
const BEAM_TARGET: Vec3 = [1.8, 1.2, -0.4];
const QUAD_SIZE = 0.42;
const RAY = { length: 1.1, width: 0.12 } as const;
const BEAM_WIDTH = 0.16;
const RIBS = 7;
const TRAIL_POINTS = 11;
const CUBE_SIZE = 0.28;

/** How far across a fitted mesh reaches at most, and where its middle sits. */
const MESH_SPAN = 1.7;
const MESH_CENTER: Vec3 = [0, 0.95, 0];

/** The most triangles the sketch draws, past which it draws an even share of them. */
const MAX_TRIANGLES = 12_000;

/** One polygon placed in the scene, before the camera projects it. */
interface Placed {
  readonly points: Vec3[];
  readonly shade: number;
  readonly solid: boolean;
}

interface Camera {
  readonly eye: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
}

/**
 * One frame of the sketch of `kind`, with the camera turned `yaw` radians about the scene.
 *
 * A mesh kind draws `mesh` where one is given, and a stand-in solid until then.
 */
export function drawSketch(kind: SketchKind, yaw: number, mesh: SketchMesh | null = null): Sketch {
  const camera = orbit(yaw);
  const project = (point: Vec3): SketchPoint => projected(camera, point);
  const placed: Placed[] = [];
  const guides: [Vec3, Vec3][] = [];
  let dots: Vec3[] = PARTICLES.map((particle) => particle.at);

  switch (kind) {
    case "cameraQuad":
      for (const { at } of PARTICLES) {
        placed.push(flat(quad(at, camera.right, camera.up, QUAD_SIZE)));
      }
      break;
    case "arbitraryQuad":
      for (const { at, turn } of PARTICLES) {
        const [x, y] = frame(turn);
        placed.push(flat(quad(at, x, y, QUAD_SIZE)));
      }
      break;
    case "ray":
      for (const { at, turn } of PARTICLES) {
        const axis = frame(turn)[2];
        placed.push(
          flat(strip(camera, [at, add(at, scale(axis, RAY.length))], () => RAY.width)[0]!),
        );
      }
      break;
    case "beam":
      placed.push(...strip(camera, [BEAM_SOURCE, BEAM_TARGET], () => BEAM_WIDTH).map(flat));
      dots = [BEAM_SOURCE, BEAM_TARGET];
      break;
    case "segmentBeam": {
      const ribs = sampled(RIBS, (t) =>
        add(lerp(BEAM_SOURCE, BEAM_TARGET, t), [0, -0.5 * Math.sin(Math.PI * t), 0]),
      );
      placed.push(...strip(camera, ribs, () => BEAM_WIDTH).map(flat));
      dots = ribs;
      break;
    }
    case "cameraTrail": {
      const path = trailPath();
      placed.push(...strip(camera, path, trailWidth).map(flat));
      dots = path;
      break;
    }
    case "arbitraryTrail": {
      const path = trailPath();
      placed.push(
        ...ribbon(path, (t) =>
          scale([0, Math.sin(1.4 * Math.PI * t), Math.cos(1.4 * Math.PI * t)], trailWidth(t)),
        ).map(flat),
      );
      dots = path;
      break;
    }
    case "mesh":
    case "attachedMesh":
      if (mesh !== null) {
        placed.push(...triangles(mesh));
        dots = [];
        break;
      }

      if (kind === "attachedMesh") {
        placed.push(...box(camera, [0, 0.55, 0], frame([0, 0]), [0.32, 0.55, 0.22]));
        dots = [[0, 1.3, 0]];
        break;
      }

      for (const { at, turn } of PARTICLES) {
        placed.push(...box(camera, at, frame(turn), [CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]));
      }
      break;
    case "projection": {
      const above: Vec3 = [0, 1.4, 0];
      const decal = quad([0, 0.002, 0], [1, 0, 0], [0, 0, 1], 0.7);
      placed.push(flat(decal));
      guides.push(...decal.map((corner): [Vec3, Vec3] => [above, corner]));
      dots = [above];
      break;
    }
    case "none":
      break;
  }

  const shapes = placed
    .map((shape) => ({ shape, depth: mean(shape.points.map((point) => depthOf(camera, point))) }))
    .sort((left, right) => right.depth - left.depth)
    .map(({ shape }) => ({
      points: shape.points.map(project),
      shade: shape.shade,
      solid: shape.solid,
    }));

  return {
    ground: groundLines().map(([from, to]) => [project(from), project(to)]),
    shapes,
    guides: guides.map(([from, to]) => [project(from), project(to)]),
    dots: dots.map(project),
  };
}

/** The camera at `yaw` about the scene's target, looking at it. */
function orbit(yaw: number): Camera {
  const { distance, pitch, target } = ORBIT;
  const eye: Vec3 = add(target, [
    distance * Math.sin(yaw) * Math.cos(pitch),
    distance * Math.sin(pitch),
    distance * Math.cos(yaw) * Math.cos(pitch),
  ]);
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, UP));

  return { eye, right, up: cross(right, forward), forward };
}

function projected(camera: Camera, point: Vec3): SketchPoint {
  const offset = sub(point, camera.eye);
  const depth = Math.max(dot(offset, camera.forward), 0.1);

  return [
    SKETCH_VIEW.width / 2 + (FOCAL * dot(offset, camera.right)) / depth,
    SKETCH_VIEW.height / 2 - (FOCAL * dot(offset, camera.up)) / depth,
  ];
}

function depthOf(camera: Camera, point: Vec3): number {
  return dot(sub(point, camera.eye), camera.forward);
}

/** A particle's local axes after turning `yaw` about Y and then `pitch` about X. */
function frame([yaw, pitch]: readonly [number, number]): readonly [Vec3, Vec3, Vec3] {
  const turned = (axis: Vec3): Vec3 => turnY(turnX(axis, pitch), yaw);

  return [turned([1, 0, 0]), turned([0, 1, 0]), turned([0, 0, 1])];
}

function turnX([x, y, z]: Vec3, angle: number): Vec3 {
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
  return [x, y * cos - z * sin, y * sin + z * cos];
}

function turnY([x, y, z]: Vec3, angle: number): Vec3 {
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

/** A square around `center` spanned by `across` and `along`, `size` from its middle to a side. */
function quad(center: Vec3, across: Vec3, along: Vec3, size: number): Vec3[] {
  const x = scale(across, size);
  const y = scale(along, size);

  return [
    add(sub(center, x), y),
    add(add(center, x), y),
    sub(add(center, x), y),
    sub(sub(center, x), y),
  ];
}

/** Quads joining consecutive points, each widened across its span and the view, as a camera strip is. */
function strip(camera: Camera, points: readonly Vec3[], width: (t: number) => number): Vec3[][] {
  return ribbon(points, (t, at, tangent) => {
    const view = normalize(sub(at, camera.eye));
    return scale(normalize(cross(tangent, view)), width(t));
  });
}

/** Quads joining consecutive points, each point widened by `half` either side. */
function ribbon(
  points: readonly Vec3[],
  half: (t: number, at: Vec3, tangent: Vec3) => Vec3,
): Vec3[][] {
  const last = points.length - 1;
  const edges = points.map((at, index) => {
    const tangent = normalize(
      sub(points[Math.min(index + 1, last)]!, points[Math.max(index - 1, 0)]!),
    );
    const offset = half(index / last, at, tangent);
    return [add(at, offset), sub(at, offset)] as const;
  });

  return edges.slice(1).map(([left, right], index) => {
    const [previousLeft, previousRight] = edges[index]!;
    return [previousLeft, left, right, previousRight];
  });
}

/** The faces of a box turned by `axes` that face the camera, lit from above. */
function box(
  camera: Camera,
  center: Vec3,
  axes: readonly [Vec3, Vec3, Vec3],
  size: Vec3,
): Placed[] {
  const scaled = axes.map((axis, index) => scale(axis, size[index]!)) as [Vec3, Vec3, Vec3];
  const faces: Placed[] = [];

  for (let axis = 0; axis < 3; axis += 1) {
    for (const sign of [1, -1]) {
      const normal = scale(axes[axis]!, sign);
      const middle = add(center, scale(scaled[axis]!, sign));
      if (dot(normal, sub(camera.eye, middle)) <= 0) {
        continue;
      }

      faces.push({
        points: quad(middle, scaled[(axis + 1) % 3]!, scaled[(axis + 2) % 3]!, 1),
        shade: Math.max(dot(normal, LIGHT), 0),
        solid: true,
      });
    }
  }

  return faces;
}

function trailPath(): Vec3[] {
  return sampled(TRAIL_POINTS, (t) => [
    -1.6 + 3.2 * t,
    0.7 + 0.45 * Math.sin(1.5 * Math.PI * t),
    0.5 * Math.cos(Math.PI * t),
  ]);
}

/** A trail's half-width at `t`, tapering toward its tail. */
function trailWidth(t: number): number {
  return 0.04 + 0.22 * t;
}

function groundLines(): [Vec3, Vec3][] {
  const lines: [Vec3, Vec3][] = [];
  for (let step = -2; step <= 2; step += 1) {
    lines.push([
      [step, 0, -1.5],
      [step, 0, 1.5],
    ]);
  }
  for (let step = -1.5; step <= 1.5; step += 0.75) {
    lines.push([
      [-2, 0, step],
      [2, 0, step],
    ]);
  }

  return lines;
}

/** The fill of a surface with no light on it, which a billboard is. */
const FLAT_SHADE = 0.5;

function flat(points: Vec3[]): Placed {
  return { points, shade: FLAT_SHADE, solid: false };
}

/** Every triangle of `mesh`, lit on whichever side faces the light. */
function triangles({ positions, indices }: SketchMesh): Placed[] {
  const vertex = (index: number): Vec3 => [
    positions[index * 3]!,
    positions[index * 3 + 1]!,
    positions[index * 3 + 2]!,
  ];
  const faces: Placed[] = [];

  for (let at = 0; at + 2 < indices.length; at += 3) {
    const points = [vertex(indices[at]!), vertex(indices[at + 1]!), vertex(indices[at + 2]!)];
    const normal = normalize(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!)));
    faces.push({ points, shade: Math.abs(dot(normal, LIGHT)), solid: true });
  }

  return faces;
}

/**
 * A mesh's triangles fitted to the sketch, and null for one with no extent to fit.
 *
 * A mesh past [`MAX_TRIANGLES`] keeps an even share of its triangles, which reads as the
 * same shape at the sketch's size.
 */
export function fitMesh(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): SketchMesh | null {
  const count = Math.floor(indices.length / 3);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < count * 3; at += 1) {
    const vertex = indices[at]! * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[vertex + axis]!;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }

  const extent = Math.max(max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!);
  if (!(extent > 0) || !Number.isFinite(extent)) {
    return null;
  }

  const factor = MESH_SPAN / extent;
  const fitted = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 1) {
    const axis = at % 3;
    fitted[at] = (positions[at]! - (min[axis]! + max[axis]!) / 2) * factor + MESH_CENTER[axis];
  }

  const stride = Math.ceil(count / MAX_TRIANGLES);
  const kept = new Uint32Array(Math.ceil(count / stride) * 3);
  for (let triangle = 0, out = 0; triangle < count; triangle += stride, out += 3) {
    kept[out] = indices[triangle * 3]!;
    kept[out + 1] = indices[triangle * 3 + 1]!;
    kept[out + 2] = indices[triangle * 3 + 2]!;
  }

  return { positions: fitted, indices: kept };
}

function sampled(count: number, at: (t: number) => Vec3): Vec3[] {
  return Array.from({ length: count }, (_, index) => at(index / (count - 1)));
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, by: number): Vec3 {
  return [a[0] * by, a[1] * by, a[2] * by];
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, scale(sub(b, a), t));
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const size = length(a);
  return size === 0 ? a : scale(a, 1 / size);
}
