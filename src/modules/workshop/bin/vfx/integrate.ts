import { analyticOffset } from "./analyticDrag";
import { identityInto, multiplyInto, standingInto, turnInto } from "./basis";
import { emit } from "./emit";
import { DRAG_MOTION, type DragMotion, LINGER_TYPE } from "./enums";
import { applyFields, type NoiseClock, prepareFields, type SampledFields } from "./forceFields";
import type { EmitterModel, SystemModel, ValueCurve } from "./model";
import { age01, clamp01, life01, sampled, sampleScalar } from "./particleRead";
import { FRAME_SLOTS, NOT_LINGERING, type Pool, retire, UV, UV_LAYERS, uvAt } from "./pool";
import type { Point } from "./rig";
import type { Rng } from "./Rng";
import { sampleCurve } from "./sampleCurve";
import type { Step } from "./stepper";
import { lingerSeconds, ROTATION_RATE } from "./systemModel";

/** How many slots one emitter takes in the step's motion scratch. */
const MOTION_SLOTS = 13;

/** Where `bindWeight` sits in an emitter's slots, past the acceleration and the drag. */
const BIND_SLOT = 6;

/** Where the step's change in `EmitterPosition` sits, three axes, past the bind weight. */
const MOVED_SLOT = 7;

/** Where the emitter's own `velocity` sits, three axes, past the movement. */
const VELOCITY_SLOT = 10;

/** Scratch the spawn frame's own override is stood and scaled in, once per step. */
const OVERRIDE = new Float32Array(FRAME_SLOTS);
const STOOD = new Float32Array(3);

/** Scratch the local terms of one particle's step are turned in. */
const ACCELERATION = new Float32Array(3);
const DRIFT = new Float32Array(3);
const SHIFT = new Float32Array(3);

/**
 * Scratch one particle's step is carried in: the velocity it keeps, the velocity it moves
 * at this step, that one before the fields acted, and where the particle stood.
 */
const KEPT = new Float32Array(3);
const MOVING = new Float32Array(3);
const PUSHED = new Float32Array(3);
const PLACE = new Float32Array(3);

/** Scratch the offset an emitter-space emitter's fields ride is turned in, once per step. */
const RIDDEN = new Float32Array(3);

/** The motion scratch of the step, grown to the widest system stepped. */
let MOTION = new Float32Array(0);

/** One step, and where the rig had the system's origin while it ran. */
export interface SystemStep extends Step {
  /** Where the origin stands at the end of the step, which is where a spawn lands. */
  readonly origin: Point;
  /** How far the origin travelled over the step. */
  readonly moved: Point;
  /** The system's orientation this step: the rig's facing as a basis, in the engine's space. */
  readonly yaw: Float32Array;
  /**
   * The definition's own `transform`, its basis, the outermost factor of every particle.
   * Already applied to `origin` and `moved`.
   */
  readonly world: Float32Array;
  /** The rig has soft-stopped the system, as the engine does. */
  readonly stopped: boolean;
  /** The chance every birth reads its tables at in place of its own, while the reader pins one. */
  readonly pinned?: number | null;
}

/** The definition's `transform` as a system applies it: a basis, and an offset after it. */
export interface World {
  readonly basis: Float32Array;
  readonly offset: Point;
}

/**
 * The system's `transform` as a basis and an offset.
 *
 * The file's rows are the basis and its last row the translation, so the basis here is
 * the upper block transposed. The identity and no offset for a system writing none.
 */
export function worldOf(system: SystemModel): World {
  const basis = identityInto(new Float32Array(FRAME_SLOTS));
  const held = system.transform;
  if (held === null) return { basis, offset: [0, 0, 0] };

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      basis[row * 3 + column] = held[column * 4 + row];
    }
  }
  return { basis, offset: [held[12], held[13], held[14]] };
}

/** What an emitter carries between steps, which the particle pool has nowhere to hold. */
export interface EmitterState {
  /** Seconds since the emitter started. */
  age: number;
  /** The emitter has emitted at least once. */
  emitted: boolean;
  /** The age the next batch is counted from, which starts at `timeBeforeFirstEmission`. */
  since: number;
  /** Where `EmitterPosition` stood at the last step, which an emitter-space particle follows. */
  position: [number, number, number];
  /** When the emitter was first seen finished, and null while it runs. */
  finishedAt: number | null;
  /**
   * The one chance a `ParticlesShareRandomValue` emitter reads every table at.
   *
   * The engine writes it in its restart blocks alone, so it is drawn at the first
   * emission of a run and null until then.
   */
  chance: number | null;
  /**
   * How far the spawn point has travelled since the first spawn, the odometer the emitter
   * keeps.
   */
  travelled: number;
  /** Where the last spawn was, which the next adds its distance from, and null before any. */
  spawnedAt: [number, number, number] | null;
  /** The spawn frame of the current step, which [`frameInto`] rebuilds before a batch. */
  readonly frame: Float32Array;
  /** Each noise field's impulse clock, in the order the emitter's collection lists them. */
  readonly noise: NoiseClock[];
}

/** One state per emitter, at the system's start. */
export function createEmitterStates(emitters: readonly EmitterModel[]): EmitterState[] {
  return emitters.map((emitter) => {
    const position = sampleCurve(emitter.emitterPosition, 0);
    return {
      age: 0,
      emitted: false,
      since: emitter.timeBeforeFirstEmission,
      position: [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0],
      finishedAt: null,
      chance: null,
      travelled: 0,
      spawnedAt: null,
      frame: new Float32Array(FRAME_SLOTS),
      noise: [],
    };
  });
}

/** One state per emitter standing where `states` stand, which a checkpoint holds. */
export function copyEmitterStates(states: readonly EmitterState[]): EmitterState[] {
  return states.map((state) => ({
    ...state,
    position: [...state.position],
    spawnedAt: state.spawnedAt === null ? null : [...state.spawnedAt],
    frame: state.frame.slice(),
    noise: state.noise.map((clock) => ({ ...clock })),
  }));
}

/**
 * `Mtx44_FromEulerDegreesScale(rotationOverride, scaleOverride)` as a basis, into `out`.
 *
 * The euler stood at, each column scaled by its axis. Built per step rather than held on
 * the state, so an edit to either field reaches the next batch the definition is swapped
 * under, which decision 2.5 keeps the pool through.
 */
function overrideInto(emitter: EmitterModel, out: Float32Array): Float32Array {
  STOOD.set(emitter.rotationOverride);
  standingInto(STOOD, 0, 0, out);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      out[row * 3 + column] *= emitter.scaleOverride[column];
    }
  }
  return out;
}

/**
 * The spawn frame for this step, into the state.
 *
 * The override sits under the system's orientation, which `isLocalOrientation` switches
 * in, and the definition's own transform outermost.
 */
function frameInto(emitter: EmitterModel, state: EmitterState, step: SystemStep): void {
  overrideInto(emitter, OVERRIDE);
  if (emitter.localOrientation) multiplyInto(step.yaw, OVERRIDE, state.frame);
  else state.frame.set(OVERRIDE);
  multiplyInto(step.world, state.frame, state.frame);
}

/**
 * One step of a system: every live particle integrated, then the step's own spawns.
 *
 * The engine forces `dt` to zero for a particle spawned during the step, which is why
 * the spawns land after the integration rather than before it, and is also what puts a
 * particle born this step at the origin the step ended on with no bind term of its own.
 * The linger policy runs first of all, as the engine does.
 */
export function stepEmitters(
  pool: Pool,
  system: SystemModel,
  step: SystemStep,
  rng: Rng,
  state: EmitterState[],
): void {
  const emitters = system.emitters;
  for (const own of state) own.age += step.dt;

  for (let index = 0; index < emitters.length; index += 1) {
    settle(pool, emitters[index], index, state[index], step);
  }

  for (let index = 0; index < emitters.length; index += 1) {
    frameInto(emitters[index], state[index], step);
  }
  const crossed = emitters.some((emitter) => emitter.fields !== null)
    ? emitters.map((emitter, index) => fieldsOf(emitter, state[index], step))
    : NO_FIELDS;
  const motion = emitterMotion(emitters, state, step.now);
  integrate(pool, emitters, step, motion, crossed, system.dragMotion);

  const settled = pool.count;
  for (let index = 0; index < emitters.length; index += 1) {
    emit(pool, emitters[index], index, state[index], step, rng, system.dragMotion);
  }
  if (crossed !== NO_FIELDS) kickNewborns(pool, settled, motion, crossed);
}

/** What a system none of whose emitters names a field collection reads for every one. */
const NO_FIELDS: readonly (SampledFields | null)[] = [];

/**
 * `emitter`'s force fields as this step reads them, and null for an emitter crossing none.
 *
 * They stand on the origin the step starts from, which is the one a particle's position
 * before its move was placed against, and never on the emitter's own offset. Under
 * `IsEmitterSpace` the engine hands the fields a position its emitter's offset is not yet
 * back in, so every field there rides that offset, decision 2.45 of
 * docs/plans/vfx-particle-renderer.md.
 */
function fieldsOf(
  emitter: EmitterModel,
  state: EmitterState,
  step: SystemStep,
): SampledFields | null {
  if (emitter.fields === null) return null;
  RIDDEN.fill(0);
  if (emitter.emitterSpace) {
    RIDDEN.set(state.position);
    turnInto(state.frame, RIDDEN, 0);
  }
  const origin: Point = [
    step.origin[0] - step.moved[0] + RIDDEN[0],
    step.origin[1] - step.moved[1] + RIDDEN[1],
    step.origin[2] - step.moved[2] + RIDDEN[2],
  ];
  return prepareFields(
    emitter.fields,
    life01(emitter, state),
    step.now,
    { origin, orientation: emitter.localOrientation ? step.yaw : null },
    state.noise,
  );
}

/**
 * The fields' share of each particle's birth step, the ones from `from` on being this
 * step's newborns.
 *
 * The engine integrates a newborn at a `dt` of zero, so only what no `dt` scales reaches
 * it, the noise field's impulses and the orbital field's turn, and what they change stays
 * in its velocity.
 */
function kickNewborns(
  pool: Pool,
  from: number,
  motion: Float32Array,
  fields: readonly (SampledFields | null)[],
): void {
  for (let at = from; at < pool.count; at += 1) {
    const crossed = fields[pool.emitter[at]] ?? null;
    if (crossed === null) continue;

    const held = pool.emitter[at] * MOTION_SLOTS;
    for (let axis = 0; axis < 3; axis += 1) DRIFT[axis] = motion[held + VELOCITY_SLOT + axis];
    turnInto(pool.frame, DRIFT, 0, at * FRAME_SLOTS);
    for (let axis = 0; axis < 3; axis += 1) {
      KEPT[axis] = pool.velocity[at * 3 + axis];
      MOVING[axis] = KEPT[axis] + DRIFT[axis];
    }
    pushInto(crossed, pool, at, 0);
    pool.velocity.set(KEPT, at * 3);
  }
}

/**
 * `fields` acting on the particle at `at`, over the velocity it moves at this step in
 * `MOVING`, and what they change kept in the one it carries on with in `KEPT`.
 */
function pushInto(fields: SampledFields, pool: Pool, at: number, dt: number): void {
  PUSHED.set(MOVING);
  for (let axis = 0; axis < 3; axis += 1) PLACE[axis] = pool.position[at * 3 + axis];
  applyFields(fields, MOVING, PLACE, pool.serial[at], dt);
  for (let axis = 0; axis < 3; axis += 1) KEPT[axis] += MOVING[axis] - PUSHED[axis];
}

/**
 * The linger policy for one emitter this step.
 *
 * `kFixedLifetimeAfterEmitterStops` acts on the emitter's own end of emission, and the
 * other two wait on the system being stopped, which the rig issues. On the first step
 * an emitter is seen finished, its particles are marked lingering and the fixed kinds
 * rewrite each lifetime to the age plus the linger. The max kind caps each lifetime at
 * the linger instead, so an older particle is cut off early.
 */
function settle(
  pool: Pool,
  emitter: EmitterModel,
  index: number,
  state: EmitterState,
  step: SystemStep,
): void {
  const finished =
    emitter.lingerType === LINGER_TYPE.fixedLifetimeAfterEmitterStops
      ? emitter.lifetime !== null && state.age > emitter.lifetime
      : step.stopped;
  if (!finished) return;

  /* A finished emitter births nothing, so one pass settles every particle it will have. */
  if (state.finishedAt !== null) return;
  state.finishedAt = step.now;

  const seconds = lingerSeconds(emitter);
  const capped = emitter.lingerType === LINGER_TYPE.maxLifetimeAfterEmitterDies;
  for (let at = 0; at < pool.count; at += 1) {
    if (pool.emitter[at] !== index) continue;
    pool.lingerFrom[at] = step.now;
    pool.lifetime[at] = capped
      ? Math.min(pool.lifetime[at], seconds)
      : step.now - pool.birthTime[at] + seconds;
  }
}

/**
 * Each emitter's acceleration, drag, velocity, bind weight and own movement for this step.
 *
 * The engine reads `bindWeight` per particle in its world transform pass. It is sampled
 * against the emitter's own life here, which is where `acceleration` and `drag` are
 * already read for the same reason. A finished emitter switches in its keyed linger
 * curves where it has them, read against the linger's own progress.
 *
 * The movement is how far `EmitterPosition` shifted since the last step, and it is zero
 * for an emitter whose particles are stored in the system's space. The engine re-adds
 * the whole position to an emitter-space particle every frame rather than storing it,
 * and adding the difference to a stored position lands in the same place.
 */
function emitterMotion(
  emitters: readonly EmitterModel[],
  state: EmitterState[],
  now: number,
): Float32Array {
  const width = emitters.length * MOTION_SLOTS;
  if (MOTION.length < width) MOTION = new Float32Array(width);
  const out = MOTION;

  for (let index = 0; index < emitters.length; index += 1) {
    const emitter = emitters[index];
    const own = state[index];
    const t01 = life01(emitter, own);
    const at = index * MOTION_SLOTS;

    const linger = own.finishedAt === null ? null : emitter.linger;
    const seconds = lingerSeconds(emitter);
    const l01 =
      own.finishedAt === null || seconds <= 0 ? 1 : clamp01((now - own.finishedAt) / seconds);

    axesInto(keyed(linger?.acceleration, emitter.acceleration, l01, t01), out, at);
    axesInto(keyed(linger?.drag, emitter.drag, l01, t01), out, at + 3);
    out[at + BIND_SLOT] = sampleScalar(emitter.bindWeight, t01);
    axesInto(keyed(linger?.velocity, emitter.velocity, l01, t01), out, at + VELOCITY_SLOT);

    const stood = sampled(emitter.emitterPosition, t01);
    for (let axis = 0; axis < 3; axis += 1) {
      const stoodAt = stood[axis];
      out[at + MOVED_SLOT + axis] = emitter.emitterSpace ? stoodAt - own.position[axis] : 0;
      own.position[axis] = stoodAt;
    }
  }

  return out;
}

/** The linger's own curve at `l01` where the emitter switches one in, else `plain` at `t01`. */
function keyed(
  held: ValueCurve | null | undefined,
  plain: ValueCurve,
  l01: number,
  t01: number,
): Float32Array {
  return held ? sampled(held, l01) : sampled(plain, t01);
}

/**
 * Every live particle moved through one step, and the ones past their lifetime retired.
 *
 * The velocity, the drag clamp that cannot cross zero and the order of the two are the
 * engine's own. The damping coefficient is the sum of the definition's `drag` and the
 * particle's own `birthDrag`, per axis, so a birth drag is one term of the same pass.
 * There is no per-particle birth acceleration, so the acceleration is the definition's own
 * value alone. Drag acts on the emitter's own `velocity` as well as the particle's, and
 * only the particle's keeps the change, which is what leaves a dragged emitter drift
 * spending itself over the step rather than carrying on undamped.
 *
 * `rotation0` turns the particle here rather than in the appearance pass, because an
 * integrated value accumulates over the steps taken and is not a function of the age it
 * is read at.
 *
 * `bindWeight` is the particle's share of the origin's own travel, added to where the
 * integrator put it, so a weight of zero leaves the particle in the world it was born in.
 * An emitter-space particle takes its emitter's own movement on top, in full.
 *
 * The acceleration, the drift and the emitter-space shift are the emitter's own and are
 * turned by the frame the particle was born in. The drag stays on the world's axes,
 * which is exact for a uniform drag alone.
 *
 * The emitter's force fields act on the step's velocity after the drag, and what they
 * change stays in the particle's own velocity.
 *
 * Under `kAnalyticDragMotion` the closed form of `analyticDrag.ts` takes the stepped
 * drag's place. What it eases each axis through over the step reaches the step's velocity
 * alone, so the acceleration, the drift and a field's kick go undamped.
 */
function integrate(
  pool: Pool,
  emitters: readonly EmitterModel[],
  step: SystemStep,
  motion: Float32Array,
  fields: readonly (SampledFields | null)[],
  dragMotion: DragMotion,
): void {
  const analytic = dragMotion === DRAG_MOTION.analytic;
  for (let at = pool.count - 1; at >= 0; at -= 1) {
    const age = step.now - pool.birthTime[at];
    if (age >= pool.lifetime[at]) {
      retire(pool, at);
      continue;
    }

    const held = pool.emitter[at] * MOTION_SLOTS;
    const frame = at * FRAME_SLOTS;
    for (let axis = 0; axis < 3; axis += 1) {
      ACCELERATION[axis] = motion[held + axis];
      DRIFT[axis] = motion[held + VELOCITY_SLOT + axis];
      SHIFT[axis] = motion[held + MOVED_SLOT + axis];
    }
    turnInto(pool.frame, ACCELERATION, 0, frame);
    turnInto(pool.frame, DRIFT, 0, frame);
    turnInto(pool.frame, SHIFT, 0, frame);

    const bind = motion[held + BIND_SLOT];
    const slot = at * 3;
    for (let axis = 0; axis < 3; axis += 1) {
      const drag = motion[held + 3 + axis] + pool.birthDrag[slot + axis];
      let velocity = pool.velocity[slot + axis] + ACCELERATION[axis] * step.dt;
      let drifted = velocity + DRIFT[axis];

      /* A drag at or under zero has no terminal to ease toward, and `exp` of its growth
         overflows, so it takes the stepped form. */
      if (analytic && drag > 0) {
        if (step.dt > 0) {
          const offset = analyticOffset(pool.dragTerminal[slot + axis], drag, age);
          drifted += (pool.dragOffset[slot + axis] - offset) / step.dt;
          pool.dragOffset[slot + axis] = offset;
        }
      } else if (drag !== 0) {
        let change = -drag * drifted * step.dt;
        if ((change + drifted) * drifted < 0) change = -drifted;
        drifted += change;
        velocity += change;
      }

      KEPT[axis] = velocity;
      MOVING[axis] = drifted;
    }

    const crossed = fields[pool.emitter[at]] ?? null;
    if (crossed !== null) pushInto(crossed, pool, at, step.dt);

    for (let axis = 0; axis < 3; axis += 1) {
      pool.velocity[slot + axis] = KEPT[axis];
      const moved = MOVING[axis] * step.dt + bind * step.moved[axis] + SHIFT[axis];
      pool.position[slot + axis] += moved;
      pool.travel[slot + axis] = step.dt > 0 ? moved / step.dt : 0;
    }

    turn(pool, at, emitters[pool.emitter[at]], step);
    scroll(pool, at, emitters[pool.emitter[at]], step);
  }
}

/**
 * One particle's share of both layers' integrated UV scroll and rotation for this step.
 *
 * The two rates are `IntegratedValue` classes, so they accumulate over the steps taken
 * rather than being a function of the age they are read at, as `rotation0` does. They
 * carry none of its `60x`. The birth ramps are the age times a rate and are read off the
 * age at draw time instead, because the clamp of `uvScrollClamp` applies to the ramp
 * alone.
 */
function scroll(pool: Pool, at: number, emitter: EmitterModel | undefined, step: Step): void {
  if (emitter === undefined) return;

  const through = age01(pool, at, step.now);

  for (let layer = 0; layer < UV_LAYERS; layer += 1) {
    const held = layer === 0 ? emitter.uv : emitter.multUv;
    if (held === null) continue;

    const slot = uvAt(at, layer);
    const spin = sampleScalar(held.rotateRate, through);
    const rate = sampled(held.scrollRate, through);

    pool.uv[slot + UV.scrollX] += rate[0] * step.dt;
    pool.uv[slot + UV.scrollY] += rate[1] * step.dt;
    pool.uv[slot + UV.rotate] += spin * step.dt;
  }
}

/**
 * One particle's turn for this step, added to where it already stands.
 *
 * The birth angular velocity and acceleration turn every particle. `rotation0` joins them
 * only under `isRotationEnabled`, and a lingering particle takes `LingerRotation` in its
 * place where the emitter switches it in, at the same scale.
 */
function turn(pool: Pool, at: number, emitter: EmitterModel | undefined, step: Step): void {
  if (emitter === undefined) return;

  const age = step.now - pool.birthTime[at];
  for (let axis = 0; axis < 3; axis += 1) {
    const slot = at * 3 + axis;
    pool.rotation[slot] +=
      (pool.angularVelocity[slot] + pool.angularAcceleration[slot] * age) * step.dt;
  }
  if (!emitter.rotationEnabled) return;

  const lingering = pool.lingerFrom[at] !== NOT_LINGERING;
  const rate = sampled(
    lingering && emitter.linger?.rotation ? emitter.linger.rotation : emitter.rotation0,
    age01(pool, at, step.now),
  );

  for (let axis = 0; axis < 3; axis += 1) {
    pool.rotation[at * 3 + axis] += rate[axis] * ROTATION_RATE * step.dt;
  }
}

/** A sample's three axes written into `out` from `at`. */
function axesInto(axes: Float32Array, out: Float32Array, at: number): void {
  out[at] = axes[0];
  out[at + 1] = axes[1];
  out[at + 2] = axes[2];
}
