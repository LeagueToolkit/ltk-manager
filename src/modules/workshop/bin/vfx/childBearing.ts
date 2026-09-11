import { multiplyInto, turnInto, unscaleInto } from "./basis";
import type { Child } from "./children";
import { INHERIT } from "./enums";
import type { EmitterModel, InheritanceModel } from "./model";
import {
  type DrawFrame,
  drawnPlace,
  drawnPlaceInto,
  particleBasisInto,
  type Source,
  standingFrameInto,
} from "./particleRead";
import { FRAME_SLOTS } from "./pool";
import type { Anchor } from "./rig";
import { sampleCurve } from "./sampleCurve";

/** Where a particle stands for the child it carries: a place, and a turn with its scale taken out. */
export interface Bearing {
  readonly place: Float32Array;
  readonly yaw: Float32Array;
}

/** A particle of a death-spawning emitter as the last step left it, which its death spawns at. */
export interface Seen extends Bearing {
  emitter: number;
  lifetime: number;
}

/** Scratch one particle's placement is read through. */
const PLACED = drawnPlace();
const TURNED = new Float32Array(FRAME_SLOTS);
const SCALE = new Float32Array(3);
const OFFSET = new Float32Array(3);
export const BEARING: Bearing = { place: new Float32Array(3), yaw: new Float32Array(FRAME_SLOTS) };

/** Scratch a bone child's bearing is re-rooted onto its joint in. */
const ANCHORED: Bearing = { place: new Float32Array(3), yaw: new Float32Array(FRAME_SLOTS) };
const JOINT_ORIGIN = new Float32Array(3);
const JOINT_BASIS = new Float32Array(FRAME_SLOTS);

export function seenAt(emitter: number): Seen {
  return {
    place: new Float32Array(3),
    yaw: new Float32Array(FRAME_SLOTS),
    emitter,
    lifetime: 0,
  };
}

/** `last` as a value, its place and its turn deep copied. */
export function copySeen(last: Seen): Seen {
  return {
    place: last.place.slice(),
    yaw: last.yaw.slice(),
    emitter: last.emitter,
    lifetime: last.lifetime,
  };
}

/**
 * Where the particle at `at` stands for the child it carries, into `out`.
 *
 * Its drawn place and its whole turn, with the turn's scale taken out, which plan 2.33
 * reads as an inherited scale of one. `RelativeOffset` is turned by that whole turn
 * unless `0x1` is set, and `0x2` then drops the particle's own turn from the child,
 * leaving the frame it was born in.
 */
export function bearingInto(
  parent: Source,
  emitter: EmitterModel,
  frame: DrawFrame,
  at: number,
  inheritance: InheritanceModel | null,
  out: Bearing,
): void {
  const mode = inheritance?.mode ?? 0;
  drawnPlaceInto(parent.pool, at, frame, PLACED);
  particleBasisInto(parent.pool, at, emitter, frame, TURNED);
  if (PLACED.orbited) multiplyInto(PLACED.turn, TURNED, TURNED);
  unscaleInto(TURNED, 0, out.yaw, 0, SCALE);
  out.place.set(PLACED.place);
  if (inheritance === null) return;

  const offset = sampleCurve(inheritance.offset, 0);
  for (let axis = 0; axis < 3; axis += 1) OFFSET[axis] = offset[axis] ?? 0;
  if ((mode & INHERIT.ignoreLocalOnOffset) === 0) turnInto(out.yaw, OFFSET, 0);
  for (let axis = 0; axis < 3; axis += 1) out.place[axis] += OFFSET[axis];

  if ((mode & INHERIT.ignoreLocalOnChild) === 0) return;
  standingFrameInto(parent.pool, at, emitter, frame, TURNED);
  if (PLACED.orbited) multiplyInto(PLACED.turn, TURNED, TURNED);
  unscaleInto(TURNED, 0, out.yaw, 0, SCALE);
}

/**
 * `bearing` re-rooted onto `anchor` at `now`, into `out`.
 *
 * The joint is read in the parent particle's own frame, so its origin is turned by the
 * particle before it is added and its basis stands under the particle's whole turn.
 */
function anchoredInto(bearing: Bearing, anchor: Anchor, now: number, out: Bearing): Bearing {
  JOINT_ORIGIN.set(anchor.originAt(now));
  turnInto(bearing.yaw, JOINT_ORIGIN, 0);
  for (let axis = 0; axis < 3; axis += 1)
    out.place[axis] = bearing.place[axis] + JOINT_ORIGIN[axis];
  anchor.basisInto(now, JOINT_BASIS);
  multiplyInto(bearing.yaw, JOINT_BASIS, out.yaw);
  return out;
}

/**
 * The child stood where `bearing` says, re-rooted onto its joint at `now` first where it
 * rides one, its own transform's offset on top and its basis outermost.
 */
export function standAt(child: Child, bearing: Bearing, now: number): void {
  const rooted =
    child.anchor === null ? bearing : anchoredInto(bearing, child.anchor, now, ANCHORED);
  for (let axis = 0; axis < 3; axis += 1) {
    child.origin[axis] = rooted.place[axis] + child.world.offset[axis];
  }
  child.yaw.set(rooted.yaw);
  multiplyInto(child.world.basis, child.yaw, child.orientation);
}
