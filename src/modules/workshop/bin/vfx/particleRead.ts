import { multiplyInto, standingInto, turnInto } from "./basis";
import { LINGER_TYPE, QUAD_TYPE } from "./enums";
import type { EmitterState } from "./integrate";
import type { EmitterModel, ValueCurve } from "./model";
import { FRAME_SLOTS, NOT_LINGERING, type Pool } from "./pool";
import type { Point } from "./rig";
import { sampleCurveInto } from "./sampleCurve";
import { lingerSeconds } from "./systemModel";

/** Scratch the orbit's own euler is built in, in the degrees a standing basis takes. */
const ORBITED = new Float32Array(3);

/** Scratch every curve of the step is sampled into, four channels being the widest. */
export const SAMPLED = new Float32Array(4);

/** `curve` at `t01` into `SAMPLED`, every channel the curve lacks standing at `fill`. */
export function sampled(curve: ValueCurve, t01: number, fill = 0): Float32Array {
  SAMPLED.fill(fill);
  sampleCurveInto(curve, t01, SAMPLED, 0);
  return SAMPLED;
}

/** The first channel of `curve` at `t01`, and `fill` for a curve carrying none. */
export function sampleScalar(curve: ValueCurve, t01: number, fill = 0): number {
  return sampled(curve, t01, fill)[0];
}

/** What a radian is worth in degrees, the orbital channel being authored in radians. */
const DEGREES_PER_RADIAN = 180 / Math.PI;

/** What a draw path knows about the frame it is on, which its per-particle reads take. */
export interface DrawFrame {
  /** The simulation's own clock, in seconds since the system started. */
  readonly now: number;
  /** Where the emitter stands in its own life, which its emitter-keyed curves are read at. */
  readonly phase: number;
  /** Where the rig has the system's origin, which an orbit turns a particle about. */
  readonly origin: Point;
  /** How the rig turns the system now, which a particle of its own stands on. */
  readonly orientation: Float32Array;
  /** `worldAcceleration` at the emitter's phase, sampled once for every particle drawn. */
  readonly worldAcceleration: Float32Array;
}

/**
 * A pool a draw reads, and the clock and placement its particles are read against.
 *
 * The driver is the source of the system the viewport opened, and each live child set is
 * a source of its own, so a draw walks every source of its definition.
 */
export interface Source {
  readonly pool: Pool;
  /** The simulation's own clock, in seconds since the viewport's system started. */
  readonly time: number;
  /** Seconds into this system's own run, which its emitters' phase is read at. */
  readonly elapsed: number;
  readonly origin: Point;
  /** Where the system aims, which a beam reaches for. */
  readonly target: Point;
  readonly orientation: Float32Array;
}

/** What `source` stands at this moment, for a draw of `emitter`. */
export function frameOf(source: Source, emitter: EmitterModel): DrawFrame {
  const phase = emitterPhase(emitter, source.elapsed);
  const worldAcceleration = new Float32Array(3);
  sampleCurveInto(emitter.worldAcceleration, phase, worldAcceleration, 0);
  return {
    now: source.time,
    phase,
    origin: source.origin,
    orientation: source.orientation,
    worldAcceleration,
  };
}

/** Where one particle draws and how its orbit turned it, of which a draw path keeps one. */
export interface DrawnPlace {
  /** The drawn position, in the engine's space. */
  readonly place: Float32Array;
  /** The orbit's turn as a basis, which carries meaning only while `orbited`. */
  readonly turn: Float32Array;
  orbited: boolean;
}

/** The scratch [`drawnPlaceInto`] writes, one per draw path. */
export function drawnPlace(): DrawnPlace {
  return { place: new Float32Array(3), turn: new Float32Array(FRAME_SLOTS), orbited: false };
}

/**
 * The scale and colour a particle draws at, into the caller's own scratch.
 *
 * Each is the birth value times the curve rather than the curve alone, the two passes the
 * engine runs after the integrator. A lingering particle reads `LingerScale` and
 * `SeparateLingerColor` against the linger's own progress instead, where its emitter
 * switches them in.
 */
export function appearance(
  pool: Pool,
  index: number,
  emitter: EmitterModel,
  now: number,
  out: { scale: Float32Array; color: Float32Array },
): void {
  const through = age01(pool, index, now);
  const linger = pool.lingerFrom[index] === NOT_LINGERING ? null : emitter.linger;
  const l01 = linger === null ? 0 : linger01(pool, index, emitter, now);

  /* Both factors stand at one before the curve, because `sampleCurveInto` writes only the
     channels the curve carries and the scratch is the caller's own across particles. */
  out.scale.fill(1, 0, 3);
  out.color.fill(1, 0, 4);

  if (linger?.scale) sampleCurveInto(linger.scale, l01, out.scale, 0);
  else if (emitter.legacySimple !== null) {
    out.scale.fill(sampleScalar(emitter.legacySimple.scale, through, 1), 0, 3);
  } else sampleCurveInto(emitter.scale0, through, out.scale, 0);
  if (linger?.color) sampleCurveInto(linger.color, l01, out.color, 0);
  else sampleCurveInto(emitter.color, through, out.color, 0);

  for (let channel = 0; channel < 3; channel += 1) {
    out.scale[channel] *= pool.birthScale[index * 3 + channel];
  }
  if (emitter.uniformScale) out.scale.fill(out.scale[0], 1, 3);
  for (let channel = 0; channel < 4; channel += 1) {
    out.color[channel] *= pool.birthColor[index * 4 + channel];
  }
}

/**
 * How far through its life the particle at `index` stands, zero to one.
 *
 * The engine's `age01`, which every curve keyed on a particle rather than on its emitter
 * is read at. A particle whose lifetime has been cut to zero reads at the end, which is
 * the engine's own guard.
 */
export function age01(pool: Pool, index: number, now: number): number {
  const lifetime = pool.lifetime[index];
  return lifetime > 0 ? clamp01((now - pool.birthTime[index]) / lifetime) : 1;
}

/**
 * Where the particle at `index` draws and how its orbit has turned it, into `out`.
 *
 * Two channels the integrator never touches, applied in the engine's own order.
 *
 * `birthOrbitalVelocity` turns first. The angle is the rate times the age, in radians, and
 * the engine folds the turn into the world matrix after its translation row is set, so it
 * carries the particle around the system's origin as well as turning its basis. A caller
 * composes `out.turn` over the particle's own standing basis wherever `out.orbited` is
 * set.
 *
 * `worldAcceleration` is added on top, un-turned, because the transform pass adds it to
 * the translation row after the integrator has built the matrix. The engine puts
 * `a * lifetime` on the particle's world velocity and `a * lifetime * lifetime` here, so
 * the two terms do not compose and only the square is a position. The lifetime is the
 * pool's current one, which is what makes the linger's rewrite move the offset in a single
 * frame.
 *
 * The value is an `IntegratedValue`, so the evaluator returns the integral over
 * `[0, age01]` rather than a sample at it, and the offset ramps from zero to
 * `a * lifetime * lifetime` over the life instead of standing at it from birth. That is
 * the reading `rotation0` and the UV rates already accumulate under. Decisions 2.23, 2.24
 * and 2.27 of docs/plans/vfx-particle-renderer.md.
 *
 * `worldAcceleration` is read against the emitter's own life, as every other
 * emitter-level curve here is.
 */
export function drawnPlaceInto(pool: Pool, index: number, frame: DrawFrame, out: DrawnPlace): void {
  const slot = index * 3;
  for (let axis = 0; axis < 3; axis += 1) out.place[axis] = pool.position[slot + axis];

  out.orbited = orbitInto(pool, index, frame.now, out.turn);
  if (out.orbited) {
    for (let axis = 0; axis < 3; axis += 1) out.place[axis] -= frame.origin[axis];
    turnInto(out.turn, out.place, 0);
    for (let axis = 0; axis < 3; axis += 1) out.place[axis] += frame.origin[axis];
  }

  const lifetime = pool.lifetime[index];
  const reached = age01(pool, index, frame.now) * lifetime * lifetime;
  for (let axis = 0; axis < 3; axis += 1) {
    out.place[axis] += frame.worldAcceleration[axis] * reached;
  }
}

/**
 * The frame the particle at `index` stands its own turn on, into `out`.
 *
 * `particleIsLocalOrientation` stands it on the system's orientation as it is now, and
 * the render pass drops the spawn frame it would otherwise be multiplied by. So such a
 * particle turns with its system where every other one keeps the frame it was born in,
 * which is what a rig that moves shows.
 */
export function standingFrameInto(
  pool: Pool,
  index: number,
  emitter: EmitterModel,
  frame: DrawFrame,
  out: Float32Array,
): void {
  if (emitter.particleLocalOrientation) {
    out.set(frame.orientation);
    return;
  }

  const at = index * FRAME_SLOTS;
  for (let slot = 0; slot < FRAME_SLOTS; slot += 1) out[slot] = pool.frame[at + slot];
}

/** How far from the world's up a travel may lean before its side is taken off x instead. */
const UPRIGHT = 0.99;

/** Scratch the particle's standing frame is read into, under its own turn. */
const BORN_FRAME = new Float32Array(FRAME_SLOTS);

/**
 * The basis the particle at `index` stands on, in the engine's space, into `out`.
 *
 * `isDirectionOriented` faces the particle where it travels, the up along its velocity
 * and the side off whichever world axis the travel leans least toward. Every other
 * particle stands its own euler on the frame it was born in.
 */
export function particleBasisInto(
  pool: Pool,
  index: number,
  emitter: EmitterModel,
  frame: DrawFrame,
  out: Float32Array,
): void {
  const vx = pool.travel[index * 3];
  const vy = pool.travel[index * 3 + 1];
  const vz = pool.travel[index * 3 + 2];
  const speed = Math.hypot(vx, vy, vz);
  if (emitter.directionOriented && speed > 0) {
    const ux = vx / speed;
    const uy = vy / speed;
    const uz = vz / speed;
    const [ax, ay, az] = Math.abs(uy) < UPRIGHT ? [0, 1, 0] : [1, 0, 0];
    let rx = ay * uz - az * uy;
    let ry = az * ux - ax * uz;
    let rz = ax * uy - ay * ux;
    const reach = Math.hypot(rx, ry, rz);
    rx /= reach;
    ry /= reach;
    rz /= reach;
    out.set([rx, ux, ry * uz - rz * uy, ry, uy, rz * ux - rx * uz, rz, uz, rx * uy - ry * ux]);
    return;
  }

  standingInto(pool.rotation, index * 3, legacyRoll(pool, index, emitter, frame.now), out);
  standingFrameInto(pool, index, emitter, frame, BORN_FRAME);
  multiplyInto(BORN_FRAME, out, out);
}

/**
 * How far the particle at `index` stretches along its travel, and one where it faces none.
 *
 * `directionVelocityScale` per unit of speed, held at `directionVelocityMinScale` at the
 * least, on the kinds `isDirectionOriented` turns. A ray is not one of them. The formula
 * is the reading of decision 2.51 of docs/plans/vfx-particle-renderer.md.
 */
export function stretchOf(pool: Pool, index: number, emitter: EmitterModel): number {
  if (
    !emitter.directionOriented ||
    emitter.quadType === QUAD_TYPE.ray ||
    emitter.legacySimple !== null
  ) {
    return 1;
  }
  const speed = Math.hypot(
    pool.travel[index * 3],
    pool.travel[index * 3 + 1],
    pool.travel[index * 3 + 2],
  );
  if (speed === 0) return 1;
  return Math.max(emitter.directionVelocityMinScale, speed * emitter.directionVelocityScale);
}

/**
 * The turn the particle at `index` has orbited by, into `out`, and false where it has none.
 *
 * The angle is `birthOrbitalVelocity` times the age, in radians, which the standing basis
 * takes in degrees. The spin channel's `pi / 180` is the only one in the integrator and
 * it never reaches this one.
 */
export function orbitInto(pool: Pool, index: number, now: number, out: Float32Array): boolean {
  const slot = index * 3;
  if (pool.orbital[slot] === 0 && pool.orbital[slot + 1] === 0 && pool.orbital[slot + 2] === 0) {
    return false;
  }

  const age = now - pool.birthTime[index];
  for (let axis = 0; axis < 3; axis += 1) {
    ORBITED[axis] = pool.orbital[slot + axis] * age * DEGREES_PER_RADIAN;
  }
  standingInto(ORBITED, 0, 0, out);
  return true;
}

/**
 * The roll a simple emitter's `rotation` adds to the particle at `index`, in degrees.
 *
 * Sampled against the age rather than accumulated, because the block declares it a
 * `ValueFloat` where `rotation0` is an integrated one. Zero for every other emitter.
 */
export function legacyRoll(pool: Pool, index: number, emitter: EmitterModel, now: number): number {
  const legacy = emitter.legacySimple;
  if (legacy === null) return 0;

  return sampleScalar(legacy.rotation, age01(pool, index, now));
}

/**
 * The whole spin of the particle at `index` about its quad's normal, in degrees.
 *
 * A complex emitter's camera quad rolls by the first euler angle, which `birthRotation0.x`
 * seeds. A simple emitter spins by the third plus [`legacyRoll`], truncated to the whole
 * degrees its basis table indexes.
 */
export function spinOf(pool: Pool, index: number, emitter: EmitterModel, now: number): number {
  if (emitter.legacySimple === null) return pool.rotation[index * 3];
  return wholeTurn(pool.rotation[index * 3 + 2] + legacyRoll(pool, index, emitter, now));
}

/** The degrees a basis table wraps an angle into. */
const WHOLE_TURN = 360;

function wholeTurn(degrees: number): number {
  return ((Math.trunc(degrees) % WHOLE_TURN) + WHOLE_TURN) % WHOLE_TURN;
}

/**
 * The erosion drive for the particle at `index`: the map value its kept band opens at.
 *
 * `erosionDriveCurve` against the age, and `LingerErosionDriveCurve` against the linger's
 * own progress once the emitter has finished. One for an emitter eroding nothing, which
 * the shader never reads.
 */
export function erosionDrive(
  pool: Pool,
  index: number,
  emitter: EmitterModel,
  now: number,
): number {
  const erosion = emitter.erosion;
  if (erosion === null) return 1;

  const lingering = pool.lingerFrom[index] !== NOT_LINGERING;
  if (lingering && erosion.lingerDrive !== null) {
    return sampleScalar(erosion.lingerDrive, linger01(pool, index, emitter, now), 1);
  }

  return sampleScalar(erosion.drive, age01(pool, index, now), 1);
}

/**
 * How far through its linger the particle at `index` stands, zero to one.
 *
 * The window is the linger's seconds for `kMaxLifetimeAfterEmitterDies`, and what is left
 * of the rewritten lifetime otherwise, which after the rewrite is the same number. A
 * particle whose emitter runs is at zero.
 */
export function linger01(pool: Pool, index: number, emitter: EmitterModel, now: number): number {
  const from = pool.lingerFrom[index];
  if (from === NOT_LINGERING) return 0;

  const window =
    emitter.lingerType === LINGER_TYPE.maxLifetimeAfterEmitterDies
      ? lingerSeconds(emitter)
      : pool.birthTime[index] + pool.lifetime[index] - from;
  return window > 0 ? clamp01((now - from) / window) : 1;
}

/**
 * Where an emitter `age` seconds old stands in its own life, which drives every
 * emitter-keyed curve.
 *
 * An emitter that never ends has no denominator, so its curves read at their start.
 */
export function emitterPhase(emitter: EmitterModel, age: number): number {
  const life = emitter.lifetime;
  if (life === null || life <= 0) return 0;
  return clamp01(age / life);
}

/** Where `state`'s emitter stands in its own life now. */
export function life01(emitter: EmitterModel, state: EmitterState): number {
  return emitterPhase(emitter, state.age);
}

/** The first channel of a sample, and zero for a curve carrying none. */
export function scalar(sampled: readonly number[]): number {
  return sampled[0] ?? 0;
}

/** `value` held inside the unit interval, which is where a normalized time lives. */
export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}
