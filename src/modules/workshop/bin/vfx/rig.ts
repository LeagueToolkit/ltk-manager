/**
 * The rig: how the world carries a system, which its definition does not say.
 *
 * Decision 2.9 in docs/plans/vfx-particle-renderer.md.
 */

/* The numbers alone rather than the module barrel, for the reason basis.ts gives. */
// eslint-disable-next-line no-restricted-imports -- the chunk the comment above names
import { CHAMPION_HEIGHT, FORWARD } from "@/modules/viewport/space";

/** A motion and the lifecycle over it, which is what drives one system's origin. */
export interface RigModel {
  readonly motion: Motion;
  readonly life: RigLife;
  /**
   * How far off the ground the origin stands, in engine units.
   *
   * A system is authored about whatever carries it, and most of them ride a champion
   * rather than the floor, so the rig stands one at half a champion's height by default
   * and a ground effect is the one that asks for zero.
   */
  readonly height: number;
  /**
   * Seconds into the run the system is soft-stopped, as `VfxSystem_Stop` does, and
   * none for a run that plays out.
   *
   * A stop is what the game issues when a buff ends, and it is what the linger of
   * `kMaxLifetimeAfterEmitterDies` and `kFixedLifetimeAfterEmitterDies` waits on.
   */
  readonly stopAt?: number | null;
  /** The skeleton a set's `boneToSpawnAt` resolves on, and none for a rig carrying no character. */
  readonly joints?: Joints | null;
}

/** A point in the engine's own space and units, which is the space the pool holds. */
export type Point = readonly [number, number, number];

/**
 * Something outside the system that moves and turns with time, such as a posed joint.
 *
 * Both reads are pure functions of time, so a seek that replays the run reaches the same
 * places a play did.
 */
export interface Anchor {
  /** Where the anchor stands at `time`, in the engine's space. */
  originAt(time: number): Point;
  /** How the anchor is turned at `time`, a row-major basis, into `out`. */
  basisInto(time: number, out: Float32Array): Float32Array;
}

/** A lookup from a bone name to its anchor, null for a name the skeleton has no joint for. */
export type Joints = (name: string) => Anchor | null;

/**
 * Where the system's origin stands over one run.
 *
 * A bone rides its anchor at the run's own phase, so it runs once beside the clock that
 * poses the anchor.
 */
export type Motion =
  | { readonly kind: "still" }
  | { readonly kind: "path"; readonly from: Point; readonly to: Point; readonly speed: number }
  | { readonly kind: "orbit"; readonly radius: number; readonly period: number }
  | { readonly kind: "bone"; readonly anchor: Anchor; readonly target: Anchor | null };

/** Whether a run plays through once or starts over from its beginning. */
export type RigLife = "once" | "loop";

/** The world's own origin, where a system that nothing moves stands. */
const ORIGIN: Point = [0, 0, 0];

/** How far a flying rig travels, in engine units. */
const FLIGHT_RANGE = CHAMPION_HEIGHT * 6;

/** How fast it travels, in engine units a second. */
const FLIGHT_SPEED = CHAMPION_HEIGHT * 8;

/** Where a rig stands by default, so an effect authored about its origin clears the ground. */
export const STAND_HEIGHT = CHAMPION_HEIGHT / 2;

/** How wide an orbiting rig circles, and how long one revolution takes in seconds. */
const ORBIT = { radius: CHAMPION_HEIGHT * 1.5, period: 3 } as const;

/** How far ahead a rig that flies nowhere aims, in engine units. */
const TARGET_REACH = CHAMPION_HEIGHT * 3;

/**
 * A path of `distance` units across the origin at flight height, travelled at `speed`.
 *
 * The path is centred rather than starting at the origin, so an effect that is only
 * itself in flight is on screen for the whole run.
 */
export function flightPath(distance: number, speed: number): Motion {
  return {
    kind: "path",
    from: [-distance / 2, 0, 0],
    to: [distance / 2, 0, 0],
    speed,
  };
}

/** The rigs the picker offers, each a motion and a lifecycle over it. */
export const RIG_PRESETS = {
  still: { motion: { kind: "still" }, life: "once", height: STAND_HEIGHT },
  burst: { motion: { kind: "still" }, life: "loop", height: STAND_HEIGHT },
  missile: { motion: flightPath(FLIGHT_RANGE, FLIGHT_SPEED), life: "loop", height: STAND_HEIGHT },
  trail: {
    motion: { kind: "orbit", radius: ORBIT.radius, period: ORBIT.period },
    life: "once",
    height: STAND_HEIGHT,
  },
} as const satisfies Record<string, RigModel>;

/** Which rig the picker is showing, which names the pill the popover hangs off. */
export type RigPreset = keyof typeof RIG_PRESETS;

/** A rig, and the preset the reader picked before tuning it. */
export interface RigChoice {
  readonly preset: RigPreset;
  readonly rig: RigModel;
}

/** The rig a viewport opens on, which is the one that moves nothing. */
export const FIRST_RIG: RigChoice = { preset: "still", rig: RIG_PRESETS.still };

/** Where the origin stands `time` seconds into a run, `height` off the ground. */
export function originAt(motion: Motion, time: number, height = 0): Point {
  return lifted(pathAt(motion, time), height);
}

/** `point` raised by `height` on the up axis. */
function lifted(point: Point, height: number): Point {
  return height === 0 ? point : [point[0], point[1] + height, point[2]];
}

function pathAt(motion: Motion, time: number): Point {
  switch (motion.kind) {
    case "still":
      return ORIGIN;

    case "path": {
      const flight = distance(motion.from, motion.to);
      const held = flight > 0 && motion.speed > 0 ? (time * motion.speed) / flight : 1;
      const at = Math.min(Math.max(held, 0), 1);
      return [
        motion.from[0] + (motion.to[0] - motion.from[0]) * at,
        motion.from[1] + (motion.to[1] - motion.from[1]) * at,
        motion.from[2] + (motion.to[2] - motion.from[2]) * at,
      ];
    }

    case "orbit": {
      const turn = motion.period > 0 ? (time / motion.period) * Math.PI * 2 : 0;
      return [Math.cos(turn) * motion.radius, 0, Math.sin(turn) * motion.radius];
    }

    case "bone":
      return motion.anchor.originAt(time);
  }
}

/**
 * Where the system aims `time` seconds into a run, which is what a beam reaches for.
 *
 * A path aims where it lands, an orbit aims at what it circles, and a bone at its target
 * joint. A still rig, and a bone with no target, aim a fixed reach ahead so a beam has a
 * length to draw.
 */
export function targetAt(motion: Motion, time: number, height = 0): Point {
  switch (motion.kind) {
    case "still":
      return lifted([TARGET_REACH, 0, 0], height);
    case "path":
      return lifted(motion.to, height);
    case "orbit":
      return lifted(ORIGIN, height);
    case "bone": {
      if (motion.target !== null) return lifted(motion.target.originAt(time), height);
      const [x, y, z] = motion.anchor.originAt(time);
      return lifted([x + TARGET_REACH, y, z], height);
    }
  }
}

/**
 * Which way the system faces `time` seconds into a run, a unit vector in the ground plane.
 *
 * A path faces where it is going and an orbit its own tangent, the way the engine yaws a
 * missile toward its target and a unit toward its travel. A bone faces along its joint's
 * own `+Z`, and a still rig faces [`FORWARD`].
 */
export function facingAt(motion: Motion, time: number): Point {
  switch (motion.kind) {
    case "still":
      return FORWARD;
    case "path":
      return flat(displacement(motion.from, motion.to));
    case "orbit": {
      const turn = motion.period > 0 ? (time / motion.period) * Math.PI * 2 : 0;
      return flat([-Math.sin(turn), 0, Math.cos(turn)]);
    }
    case "bone": {
      const basis = motion.anchor.basisInto(time, ANCHOR_BASIS);
      return flat([basis[2], basis[5], basis[8]]);
    }
  }
}

const ANCHOR_BASIS = new Float32Array(9);

/** `direction` laid flat as a unit vector, and [`FORWARD`] for one with no reach in the plane. */
function flat(direction: Point): Point {
  const length = Math.hypot(direction[0], direction[2]);
  if (length === 0) return FORWARD;
  return [direction[0] / length, 0, direction[2] / length];
}

/**
 * How far into its own run the rig stands `time` seconds into the simulation.
 *
 * A looping rig wraps rather than counting from wherever it was bound, so the phase is a
 * function of the clock alone and a seek reaches what a play reaches. Anything the rig
 * remembers about when it was picked would be a recording the replay of decision 2.6
 * cannot reproduce.
 */
export function phaseAt(rig: RigModel, time: number, span: number, tail = 0): number {
  if (rig.life !== "loop") return time;

  const length = runLength(rig.motion, span, tail);
  return length > 0 ? time % length : time;
}

/**
 * How long one run lasts, which is when a looping rig starts over and what a scrub spans.
 *
 * A path ends on arrival plus `tail`, because a missile's system is stopped where the
 * missile lands and its particles play out for their linger. Every other motion runs for
 * as long as the system itself takes to play out, and so does a path that arrives the
 * moment it sets off, which would otherwise be a run of no length that a looping rig
 * restarts on every step.
 */
export function runLength(motion: Motion, span: number, tail = 0): number {
  if (motion.kind === "path") {
    const flight = flightTime(motion);
    return flight > 0 ? flight + tail : span;
  }
  if (motion.kind === "orbit") return Math.max(motion.period, span);

  return span;
}

/** How long a path takes to fly, and zero for one that never moves. */
export function flightTime(motion: Motion): number {
  if (motion.kind !== "path" || motion.speed <= 0) return 0;
  return distance(motion.from, motion.to) / motion.speed;
}

/** The path has arrived `time` seconds into its run, which is where the engine stops a missile. */
export function landed(motion: Motion, time: number): boolean {
  const flight = flightTime(motion);
  return flight > 0 && time >= flight;
}

/** How far apart two points stand. */
export function distance(from: Point, to: Point): number {
  return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
}

/** How far, and which way, `to` lies from `from`. */
export function displacement(from: Point, to: Point): Point {
  return [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
}
