/**
 * The force field kinds, each acting on one particle's velocity for one step.
 *
 * The engine runs acceleration, attraction, noise, drag and orbital in that order, after
 * the particle's own drag and before its position moves. Every vector here is in the
 * engine's space. Decision 2.45 of docs/plans/vfx-particle-renderer.md is how the preview
 * reads them.
 */

import { turnInto } from "./basis";
import type { FieldsModel, ValueCurve } from "./model";
import type { Point } from "./rig";
import { sampleCurve, sampleCurveInto } from "./sampleCurve";

type Vector = ArrayLike<number>;

/** How close to its axis an orbital field leaves a particle alone, as `1 - cos` of the angle. */
const ON_AXIS = 1e-4;

/** The speed across its axis below which an orbital field turns nothing. */
const STILL = 0.001;

/** What a 32-bit hash is divided by to land in `[0, 1)`. */
const HASH_SPAN = 2 ** 32;

/**
 * The squared length below which a draw is left as it is rather than normalised, as the
 * engine's own normalize leaves it. A stand-in, since no value for it is attested.
 */
const LEAST_NORMALISED = 1e-12;

/** The most impulses one step fires, which bounds a step against a frequency in the millions. */
const MOST_IMPULSES = 256;

/** A noise field's impulse clock, which the engine keeps on the field object for the emitter's life. */
export interface NoiseClock {
  /** When the field last fired, and null before its first update. */
  last: number | null;
  /** How many impulses it has fired, which keeps each impulse's directions apart. */
  fired: number;
}

/** A clock that has not seen its field's first update. */
export function noiseClock(): NoiseClock {
  return { last: null, fired: 0 };
}

/**
 * How many impulses a noise field at `rate` owes at `now`, its clock moved past them.
 *
 * The engine fires one on the field's first update, and after it the whole periods of
 * `rate` crossed on absolute time since the last one fired, so a rate of zero fires once
 * in the field's life.
 */
export function impulsesOwed(clock: NoiseClock, rate: number, now: number): number {
  const owed =
    clock.last === null ? 1 : Math.max(Math.trunc(rate * now) - Math.trunc(rate * clock.last), 0);
  if (owed > 0) clock.last = now;
  const fired = Math.min(owed, MOST_IMPULSES);
  clock.fired += fired;
  return fired;
}

/** A field acting from a centre, inside a radius, at a strength a second. */
export interface SampledReach {
  readonly centre: Point;
  readonly strength: number;
  readonly radius: number;
}

/** A noise field as one step reads it. */
export interface SampledNoise {
  readonly centre: Point;
  readonly radius: number;
  /** `velocityDelta`, the size of one impulse. */
  readonly delta: number;
  /** `axisFraction`, what each axis of an impulse is multiplied by. */
  readonly axes: Point;
  /** How many impulses the step fires, from `impulsesOwed`. */
  readonly kicks: number;
  /** How many the field had fired before them, which each impulse's direction is drawn off. */
  readonly first: number;
  /** The field's place in its list, which keeps two noise fields' draws apart. */
  readonly slot: number;
}

/** One emitter's fields as one step reads them, every centre and axis in the engine's space. */
export interface SampledFields {
  /** Every acceleration field summed, as the engine pre-sums them. */
  readonly acceleration: Float32Array;
  readonly attraction: readonly SampledReach[];
  readonly noise: readonly SampledNoise[];
  readonly drag: readonly SampledReach[];
  /** Each orbital field's unit axis. */
  readonly orbital: readonly Point[];
  /** What every orbital field turns about, which no field authors. */
  readonly origin: Point;
}

/** Where one emitter's fields stand for a step. */
export interface FieldPlace {
  /** What every centre is placed from, and what an orbital field turns about. */
  readonly origin: Point;
  /**
   * The system's orientation, which `isLocalSpace` turns a direction by, and null for an
   * emitter whose `isLocalOrientation` is off, which leaves every direction as authored.
   */
  readonly orientation: Float32Array | null;
}

/**
 * `fields` at the emitter's life `t01`, standing at `place`, each noise field's clock moved
 * past the impulses it fires at `now`.
 *
 * A centre is its `Position` from the origin, turned by nothing and scaled by nothing, and
 * a radius is as authored. `isLocalSpace` turns an acceleration or an orbital axis and
 * reaches nothing else.
 */
export function prepareFields(
  fields: FieldsModel,
  t01: number,
  now: number,
  place: FieldPlace,
  clocks: NoiseClock[],
): SampledFields {
  const acceleration = new Float32Array(3);
  for (const each of fields.acceleration) {
    const held = sampledInto(each.acceleration, t01);
    if (each.localSpace && place.orientation !== null) turnInto(place.orientation, held, 0);
    for (let axis = 0; axis < 3; axis += 1) acceleration[axis] += held[axis];
  }

  const centreOf = (position: ValueCurve): Point => {
    const held = sampledInto(position, t01);
    return [place.origin[0] + held[0], place.origin[1] + held[1], place.origin[2] + held[2]];
  };
  const reach = (position: ValueCurve, strength: ValueCurve, radius: ValueCurve) => ({
    centre: centreOf(position),
    strength: scalarOf(strength, t01),
    radius: scalarOf(radius, t01),
  });

  const orbital: Point[] = [];
  for (const each of fields.orbital) {
    const axis = sampledInto(each.direction, t01);
    if (each.localSpace && place.orientation !== null) turnInto(place.orientation, axis, 0);
    const length = Math.hypot(axis[0], axis[1], axis[2]);
    if (length === 0) continue;
    orbital.push([axis[0] / length, axis[1] / length, axis[2] / length]);
  }

  return {
    acceleration,
    attraction: fields.attraction.map((each) =>
      reach(each.position, each.acceleration, each.radius),
    ),
    noise: fields.noise.map((each, slot) => {
      clocks[slot] ??= noiseClock();
      const first = clocks[slot].fired;
      return {
        centre: centreOf(each.position),
        radius: scalarOf(each.radius, t01),
        delta: scalarOf(each.velocityDelta, t01),
        axes: each.axisFraction,
        kicks: impulsesOwed(clocks[slot], scalarOf(each.frequency, t01), now),
        first,
        slot,
      };
    }),
    drag: fields.drag.map((each) => reach(each.position, each.strength, each.radius)),
    orbital,
    origin: place.origin,
  };
}

/**
 * Every field of `fields` acting on the velocity `v` of the particle standing `at`, in the
 * engine's order.
 *
 * `serial` is the particle's, which a noise field draws its directions off. A `dt` of zero
 * is a particle's birth step, which only the noise and the orbital fields reach.
 */
export function applyFields(
  fields: SampledFields,
  v: Float32Array,
  at: Vector,
  serial: number,
  dt: number,
): void {
  accelerateInto(v, fields.acceleration, dt);
  for (const each of fields.attraction) {
    attractInto(v, at, each.centre, each.strength, each.radius, dt);
  }
  for (const each of fields.noise) noiseInto(v, at, each, serial);
  for (const each of fields.drag) dragInto(v, at, each.centre, each.strength, each.radius, dt);
  for (const axis of fields.orbital) orbitFieldInto(v, at, fields.origin, axis);
}

/** One step of an acceleration field's push. */
export function accelerateInto(v: Float32Array, acceleration: Vector, dt: number): void {
  for (let axis = 0; axis < 3; axis += 1) v[axis] += acceleration[axis] * dt;
}

/** A pull toward `centre` inside `radius`, constant in size, its distance floored at one unit. */
export function attractInto(
  v: Float32Array,
  at: Vector,
  centre: Vector,
  strength: number,
  radius: number,
  dt: number,
): void {
  const reach = within(at, centre, radius);
  if (reach < 0) return;

  const scale = (strength * dt) / Math.sqrt(Math.max(reach, 1));
  for (let axis = 0; axis < 3; axis += 1) v[axis] += (centre[axis] - at[axis]) * scale;
}

/**
 * The step's impulses of `noise` on one particle inside its radius, each a unit direction
 * times `velocityDelta` and each axis's fraction, and none of them scaled by the step.
 *
 * A direction is a cube sample normalised, as three uniform draws and a normalise make it,
 * hashed off the particle's serial, the field and the impulse rather than drawn from a
 * stream, so a seek replays it.
 */
export function noiseInto(v: Float32Array, at: Vector, noise: SampledNoise, serial: number): void {
  if (noise.kicks === 0 || within(at, noise.centre, noise.radius) < 0) return;

  for (let kick = 0; kick < noise.kicks; kick += 1) {
    directionInto(serial, noise.slot, noise.first + kick, DIRECTION);
    for (let axis = 0; axis < 3; axis += 1) {
      v[axis] += DIRECTION[axis] * noise.delta * noise.axes[axis];
    }
  }
}

/** Each axis of `v` damped by `strength` a second inside `radius`, and never turned round. */
export function dragInto(
  v: Float32Array,
  at: Vector,
  centre: Vector,
  strength: number,
  radius: number,
  dt: number,
): void {
  if (within(at, centre, radius) < 0) return;

  const kept = Math.max(1 - strength * dt, 0);
  for (let axis = 0; axis < 3; axis += 1) v[axis] *= kept;
}

/**
 * The motion across `axis` turned tangential about `centre`, keeping its speed, its motion
 * along the axis and the sense it turns in.
 *
 * The engine's guard leaves alone a particle barely moving across the axis or standing on
 * the axis's own side of the centre, and only that side.
 */
export function orbitFieldInto(v: Float32Array, at: Vector, centre: Vector, axis: Vector): void {
  const along = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const px = v[0] - along * axis[0];
  const py = v[1] - along * axis[1];
  const pz = v[2] - along * axis[2];
  const speed = Math.hypot(px, py, pz);
  if (speed <= STILL) return;

  let dx = at[0] - centre[0];
  let dy = at[1] - centre[1];
  let dz = at[2] - centre[2];
  const reach = Math.hypot(dx, dy, dz);
  if (reach === 0) return;
  dx /= reach;
  dy /= reach;
  dz /= reach;
  if (Math.abs(1 - (axis[0] * dx + axis[1] * dy + axis[2] * dz)) <= ON_AXIS) return;

  let tx = dy * axis[2] - dz * axis[1];
  let ty = dz * axis[0] - dx * axis[2];
  let tz = dx * axis[1] - dy * axis[0];
  const length = Math.hypot(tx, ty, tz);
  if (length === 0) return;
  let scale = speed / length;
  if (tx * px + ty * py + tz * pz < 0) scale = -scale;
  tx *= scale;
  ty *= scale;
  tz *= scale;

  v[0] = along * axis[0] + tx;
  v[1] = along * axis[1] + ty;
  v[2] = along * axis[2] + tz;
}

/** The squared distance from `at` to `centre`, and -1 where it lies past `radius`. */
function within(at: Vector, centre: Vector, radius: number): number {
  const dx = centre[0] - at[0];
  const dy = centre[1] - at[1];
  const dz = centre[2] - at[2];
  const reach = dx * dx + dy * dy + dz * dz;
  return reach <= radius * radius ? reach : -1;
}

/** Scratch a noise field's direction is drawn into. */
const DIRECTION = new Float32Array(3);

/** Scratch one vector curve is sampled into. */
const SAMPLED = new Float32Array(3);

/** One impulse's direction, off one particle's serial, its field and the impulse's count. */
function directionInto(serial: number, slot: number, impulse: number, out: Float32Array): void {
  const first = mixed(mixed(serial + 1) ^ mixed((Math.imul(slot + 1, 0x9e3779b1) + impulse) | 0));
  const second = mixed(first ^ 0x68e31da4);
  const third = mixed(second ^ 0x1b56c4e9);
  out[0] = (first / HASH_SPAN) * 2 - 1;
  out[1] = (second / HASH_SPAN) * 2 - 1;
  out[2] = (third / HASH_SPAN) * 2 - 1;

  const squared = out[0] * out[0] + out[1] * out[1] + out[2] * out[2];
  if (squared < LEAST_NORMALISED) return;
  const length = Math.sqrt(squared);
  out[0] /= length;
  out[1] /= length;
  out[2] /= length;
}

/** A 32-bit integer finaliser, which spreads every input bit across the output. */
function mixed(value: number): number {
  let held = value | 0;
  held = Math.imul(held ^ (held >>> 16), 0x7feb352d);
  held = Math.imul(held ^ (held >>> 15), 0x846ca68b);
  return (held ^ (held >>> 16)) >>> 0;
}

/** A vector curve's sample into the scratch, a missing channel read as zero. */
function sampledInto(curve: ValueCurve, t01: number): Float32Array {
  SAMPLED.fill(0);
  sampleCurveInto(curve, t01, SAMPLED, 0);
  return SAMPLED;
}

function scalarOf(curve: ValueCurve, t01: number): number {
  return sampleCurve(curve, t01)[0] ?? 0;
}
