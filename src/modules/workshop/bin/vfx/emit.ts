import { analyticTerminal } from "./analyticDrag";
import { turnInto } from "./basis";
import { DRAG_MOTION, type DragMotion } from "./enums";
import type { EmitterState, SystemStep } from "./integrate";
import type { EmitterModel, LegacySimpleModel, UvLayer } from "./model";
import { life01, sampleScalar, scalar } from "./particleRead";
import { FRAME_SLOTS, type Pool, spawn, UV, UV_LAYERS, uvAt } from "./pool";
import type { Rng } from "./Rng";
import { drawCurve, drawCurveInto } from "./sampleCurve";
import { birth, sampleShape } from "./spawnShape";

/** The share of the rate one step may spend, which is the engine's own burst cap. */
const BURST_SHARE = 0.33;

/** Scratch the spawn shape writes one birth into, reused across every spawn. */
const BORN = birth();

/** Scratch a trail's or a beam's tiling is drawn into, of which the pool keeps two. */
const TILED = new Float32Array(3);

/** Scratch a spawn's own position, turned into the step's world space to grow the odometer. */
const SPAWN_AT = new Float32Array(3);

/**
 * The particles one emitter owes this step, born with their birth values.
 *
 * The count, its burst cap and the two rules that make a first emission are the engine's
 * own, and a trail's `mMaxAddedPerFrame` caps the count last of all. Each particle takes
 * two draws off the stream before its birth values are read, its roll and then the one
 * chance every probability table of its birth is read at, which is the order decision 2.6
 * of docs/plans/vfx-particle-renderer.md fixes. Under `ParticlesShareRandomValue` the
 * chance is the emitter's own for its whole life and no particle draws one. The spawn
 * shape draws after them, and its turn reaches the birth velocity as well as the offset,
 * which is the one spawn-time path that turns it.
 *
 * The odometer advances by how far the spawn point moved since the last spawn, before
 * the batch is stamped with it, so a particle carries the distance at its own birth.
 */
export function emit(
  pool: Pool,
  emitter: EmitterModel,
  index: number,
  state: EmitterState,
  step: SystemStep,
  rng: Rng,
  dragMotion: DragMotion,
): void {
  if (emitter.disabled || step.stopped) return;
  if (emitter.singleParticle && state.emitted) return;
  if (state.age < emitter.timeBeforeFirstEmission) return;
  if (emitter.lifetime !== null && state.age > emitter.lifetime) return;

  const t01 = life01(emitter, state);
  const rate = Math.max(sampleScalar(emitter.rate, t01), 0);
  /* An edit to `timeBeforeFirstEmission` reaches an emitter that has yet to emit, whose
     `since` is that field and nothing else. */
  if (!state.emitted) state.since = emitter.timeBeforeFirstEmission;

  let count = Math.min(
    Math.trunc((state.age - state.since) * rate),
    Math.trunc(rate * BURST_SHARE) + 1,
  );

  if (!state.emitted) {
    if (count === 0) count = 1;
    if (emitter.singleParticle) count = Math.max(Math.trunc(rate) & 0xffff, 1);
  }
  const most = emitter.trail?.maxAddedPerFrame ?? 0;
  if (most > 0 && count >= most) count = most;
  if (count <= 0) return;

  travel(state, step);
  const tiling = emitter.trail?.tiling ?? emitter.beam?.tiling ?? null;
  if (emitter.sharedRandom && state.chance === null) state.chance = rng.unitFloat();

  for (let born = 0; born < count; born += 1) {
    const roll = rng.unitFloat();
    /* Drawn even under a pin, so the stream every later draw reads is the unpinned run's. */
    const drawn = state.chance ?? rng.unitFloat();
    const chance = step.pinned ?? drawn;
    const lifetime = scalar(drawCurve(emitter.particleLifetime, t01, chance));
    const at = spawn(pool, index, step.now, lifetime, roll);
    if (at === null) break;

    /* Both spaces put a newborn at the emitter: the system's space bakes the offset in
       here, and the emitter's space stores what the integrator then moves. The whole
       local placement is turned by the spawn frame, and so is the birth velocity. */
    sampleShape(emitter.shape, rng, t01, chance, BORN);
    for (let axis = 0; axis < 3; axis += 1) {
      BORN.offset[axis] += state.position[axis] + emitter.translationOverride[axis];
    }
    turnInto(state.frame, BORN.offset, 0);
    for (let axis = 0; axis < 3; axis += 1) {
      pool.position[at * 3 + axis] = step.origin[axis] + BORN.offset[axis];
    }
    pool.frame.set(state.frame, at * FRAME_SLOTS);
    drawCurveInto(emitter.birthVelocity, t01, chance, pool.velocity, at * 3);
    if (BORN.turned) turnInto(BORN.turn, pool.velocity, at * 3);
    turnInto(state.frame, pool.velocity, at * 3);
    if (emitter.legacySimple === null) {
      drawCurveInto(emitter.birthRotation0, t01, chance, pool.rotation, at * 3);
      drawCurveInto(emitter.birthRotationalVelocity0, t01, chance, pool.angularVelocity, at * 3);
      drawCurveInto(emitter.birthScale0, t01, chance, pool.birthScale, at * 3);
    } else {
      bornSimple(pool, at, emitter.legacySimple, t01, chance);
    }
    drawCurveInto(
      emitter.birthRotationalAcceleration,
      t01,
      chance,
      pool.angularAcceleration,
      at * 3,
    );
    drawCurveInto(emitter.birthDrag, t01, chance, pool.birthDrag, at * 3);
    if (dragMotion === DRAG_MOTION.analytic) easeOut(pool, at);
    drawCurveInto(emitter.birthOrbitalVelocity, t01, chance, pool.orbital, at * 3);
    drawCurveInto(emitter.birthColor, t01, chance, pool.birthColor, at * 4);
    bornUv(pool, at, emitter, t01, roll, chance);

    pool.odometer[at] = state.travelled;
    if (tiling !== null) {
      drawCurveInto(tiling, t01, chance, TILED, 0);
      pool.tiling[at * 2] = TILED[0];
      pool.tiling[at * 2 + 1] = TILED[1];
    }
  }

  state.emitted = true;
  state.since = rate > 0 ? state.since + count / rate : state.age;
}

/** A newborn's birth velocity traded for the displacement `kAnalyticDragMotion` eases out to. */
function easeOut(pool: Pool, at: number): void {
  for (let slot = at * 3; slot < at * 3 + 3; slot += 1) {
    const terminal = analyticTerminal(pool.velocity[slot], pool.birthDrag[slot]);
    pool.dragTerminal[slot] = terminal;
    pool.dragOffset[slot] = terminal;
    pool.velocity[slot] = 0;
  }
}

/** The emitter's odometer moved on by this spawn's distance from the last. */
function travel(state: EmitterState, step: SystemStep): void {
  SPAWN_AT.set(state.position);
  turnInto(state.frame, SPAWN_AT, 0);
  const x = step.origin[0] + SPAWN_AT[0];
  const y = step.origin[1] + SPAWN_AT[1];
  const z = step.origin[2] + SPAWN_AT[2];

  if (state.spawnedAt === null) state.spawnedAt = [x, y, z];
  else {
    const from = state.spawnedAt;
    state.travelled += Math.hypot(x - from[0], y - from[1], z - from[2]);
    from[0] = x;
    from[1] = y;
    from[2] = z;
  }
}

/**
 * A simple emitter's birth values, one number each where a complex emitter draws three.
 *
 * The one size is drawn once and stands on every axis, `scaleBias` across and up, so a
 * table on it keeps the particle square. The roll and its rate land about the view
 * axis, which is the one a simple quad turns on.
 */
function bornSimple(
  pool: Pool,
  at: number,
  legacy: LegacySimpleModel,
  t01: number,
  chance: number,
): void {
  const size = drawCurve(legacy.birthScale, t01, chance)[0] ?? 1;
  pool.birthScale[at * 3] = size * legacy.scaleBias[0];
  pool.birthScale[at * 3 + 1] = size * legacy.scaleBias[1];
  pool.birthScale[at * 3 + 2] = size;

  pool.rotation[at * 3 + 2] = drawCurve(legacy.birthRotation, t01, chance)[0] ?? 0;
  pool.angularVelocity[at * 3 + 2] = drawCurve(legacy.birthRotationalVelocity, t01, chance)[0] ?? 0;
}

/**
 * Both layers' UV state at birth: the ramps' own numbers, and how far into its run the
 * book opens.
 *
 * A random start is the particle's own draw times the frame count, a fraction of a cell
 * included. The draw is the one the pool already holds, and the mult layer reads the base
 * layer's book, so both layers open on the same cell.
 */
function bornUv(
  pool: Pool,
  at: number,
  emitter: EmitterModel,
  t01: number,
  roll: number,
  chance: number,
): void {
  for (let layer = 0; layer < UV_LAYERS; layer += 1) {
    const held: UvLayer | null = layer === 0 ? emitter.uv : emitter.multUv;
    if (held === null) continue;

    const slot = uvAt(at, layer);
    const offset = drawCurve(held.birthOffset, t01, chance);
    const rate = drawCurve(held.birthScrollRate, t01, chance);

    pool.uv[slot + UV.birthOffsetX] = offset[0] ?? 0;
    pool.uv[slot + UV.birthOffsetY] = offset[1] ?? 0;
    pool.uv[slot + UV.birthScrollX] = rate[0] ?? 0;
    pool.uv[slot + UV.birthScrollY] = rate[1] ?? 0;
    pool.uv[slot + UV.birthRotate] = scalar(drawCurve(held.birthRotateRate, t01, chance));

    const book = held.book;
    pool.uv[slot + UV.phase] = book.randomStart ? roll * Math.max(book.frames, 0) : 0;
    pool.uv[slot + UV.frameRate] = book.rate * scalar(drawCurve(book.birthRate, t01, chance));
  }
}
