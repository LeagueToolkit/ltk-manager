import { flightInto, multiplyInto, turnInto, yawInto } from "./basis";
import { createCheckpoints } from "./checkpoints";
import {
  type ChildBirth,
  type ChildrenSnapshot,
  createChildren,
  createLineage,
  feedOf,
  snapshotByteLength,
} from "./children";
import {
  copyEmitterStates,
  createEmitterStates,
  type EmitterState,
  stepEmitters,
  type SystemStep,
  type World,
  worldOf,
} from "./integrate";
import type { SystemModel } from "./model";
import type { Source } from "./particleRead";
import {
  copyRows,
  createPool,
  FRAME_SLOTS,
  liveByteLength,
  type Pool,
  type PoolRows,
  rowsByteLength,
  writeRows,
} from "./pool";
import {
  displacement,
  facingAt,
  FIRST_RIG,
  landed,
  originAt,
  phaseAt,
  type Point,
  type RigModel,
  runLength,
  targetAt,
} from "./rig";
import { Rng } from "./Rng";
import { type Stepper, variableStepper } from "./stepper";
import { addressTheSame, emptySystem, lingerTail, systemSpan } from "./systemModel";

/** How many particles one system's pool holds, whatever its emitters ask for. */
const POOL_CAP = 32_768;

/** The step a seek replays at, which is a frame at 60 Hz. */
const SEEK_STEP = 1 / 60;

/** How far a seek replays, past which it lands on the pool it has reached. */
const SEEK_STEPS = 60 * 60;

/** How often a run keeps a checkpoint, in seconds of simulated time. */
const MARK = 0.25;

/** How many checkpoints one run holds, which covers the span a seek reaches over. */
const MOST_MARKS = (SEEK_STEPS * SEEK_STEP) / MARK;

/**
 * The bytes one run's checkpoints hold at most.
 *
 * A particle's rows are 300 bytes. Every mark of a run under 3,500 particles fits, and a
 * full pool keeps one checkpoint every four seconds, decided before each capture off the
 * live bytes rather than after it.
 */
const CHECKPOINT_BYTES = 256 * 1024 * 1024;

/** The most particles one bin of the lanes records, which is what a `Uint16Array` holds. */
const MOST_COUNTED = 0xffff;

/** Live particles per emitter at each step of one run, binned on the run's phase. */
export interface Histogram {
  /** Seconds one bin spans. */
  readonly bin: number;
  /** How many bins one run holds. */
  readonly bins: number;
  /** The live count of `emitter` at each bin, `bins` long, zero where no step has landed. */
  counts(emitter: number): Uint16Array;
  /** The last bin a step landed in this pass, and -1 before any. */
  readonly reached: number;
}

/** The lanes' histogram as the run writes it. */
interface Lanes extends Histogram {
  /** Hold `emitters` lanes over a run of `length` seconds, every bin cleared. */
  resize(emitters: number, length: number): void;
  /** Record the live counts of `pool` at the bin `phase` falls in. */
  tally(pool: Pool, phase: number): void;
  /** Open a pass over the bins the last one wrote. */
  wrap(): void;
  /** Stand the pass at `phase`, recording nothing. */
  reach(phase: number): void;
}

/** Lanes for no emitters over one bin, which a swap sizes to the system it opens. */
function createLanes(): Lanes {
  let bins = 1;
  let lanes = 0;
  let data = new Uint16Array(0);
  let reached = -1;
  const live: number[] = [];

  function binOf(phase: number): number {
    return Math.min(Math.max(Math.floor(phase / SEEK_STEP), 0), bins - 1);
  }

  return {
    bin: SEEK_STEP,
    get bins() {
      return bins;
    },
    get reached() {
      return reached;
    },
    counts(emitter) {
      return data.subarray(emitter * bins, (emitter + 1) * bins);
    },
    resize(emitters, length) {
      bins = Math.max(1, Math.ceil(Math.min(length, SEEK_STEPS * SEEK_STEP) / SEEK_STEP));
      lanes = emitters;
      if (data.length === bins * lanes) data.fill(0);
      else data = new Uint16Array(bins * lanes);
      live.length = lanes;
      reached = -1;
    },
    tally(pool, phase) {
      live.fill(0);
      for (let at = 0; at < pool.count; at += 1) {
        const emitter = pool.emitter[at];
        if (emitter >= 0 && emitter < lanes) live[emitter] += 1;
      }
      reached = binOf(phase);
      for (let emitter = 0; emitter < lanes; emitter += 1) {
        data[emitter * bins + reached] = Math.min(live[emitter], MOST_COUNTED);
      }
    },
    wrap() {
      reached = -1;
    },
    reach(phase) {
      reached = binOf(phase);
    },
  };
}

/** One moment of a run, deep copied, which a seek stands on in place of replaying to it. */
interface Checkpoint {
  /** The clock the run stood at, which the stepper is put back to. */
  readonly time: number;
  /** The seek step `time` lands on, from which a replay carries on. */
  readonly step: number;
  readonly rows: PoolRows;
  readonly states: readonly EmitterState[];
  readonly rng: Rng;
  /** How far into its own run the run stood. */
  readonly phase: number;
  readonly origin: Point;
  readonly children: ChildrenSnapshot;
  readonly births: readonly ChildBirth[];
  /** What its arrays hold, which the run's budget counts. */
  readonly bytes: number;
}

/** The simulation as a viewport drives one: a pool, a clock, and a way back to zero. */
export interface Driver extends Source {
  readonly pool: Pool;
  /** Where the simulation stands, in seconds since the system started. */
  readonly time: number;
  /** Seconds into the current run, which is the emitters' own age and wraps with a loop. */
  readonly elapsed: number;
  /** Where the rig has the system at this moment, under the definition's own transform. */
  readonly origin: Point;
  /** Where the rig aims the system at this moment, likewise, which a beam reaches for. */
  readonly target: Point;
  /**
   * How the rig turns the system at this moment, under the definition's own transform.
   *
   * The engine keeps this beside the definition's `transform`, which is what a particle
   * of `particleIsLocalOrientation` stands on in place of the frame it was born in.
   */
  readonly orientation: Float32Array;
  /** Live particles per emitter over the run, which the timeline's lanes draw. */
  readonly histogram: Histogram;
  /** Spend one frame's elapsed seconds. */
  advance(frameTime: number): void;
  /**
   * Run to `time`, carrying on from the latest checkpoint at or before it.
   *
   * A seeded pool reaches a moment by running the seed forward, and a checkpoint is one
   * moment of that run kept whole, decision 2.46 of docs/plans/vfx-particle-renderer.md.
   * A checkpoint written during a play holds what that play reached, at the frames' own
   * `dt`, and a seek through it is a run of the seed rather than the fixed-step replay a
   * seek from zero writes.
   */
  seek(time: number): void;
  restart(): void;
  /** Read every birth's tables at `chance` from here on, and at its own draw again for null. */
  pin(chance: number | null): void;
  /** Draw the next appearance pass from `next`, keeping the particles already alive. */
  swap(next: SystemModel): void;
  /** Carry the system on `next`, restarting the run where the motion itself changed. */
  steer(next: RigModel): void;
  /**
   * The live children of the child definition at `path`.
   *
   * The driver keeps the list current in place, so a draw holds it and reads it every frame.
   */
  sources(path: string): readonly Source[];
  /** How many child systems are live, at every depth of the lineage. */
  liveChildren(): number;
  /** Every child this pass has spawned, in the order they were spawned. */
  births(): readonly ChildBirth[];
}

/**
 * One system simulated from a seed.
 *
 * A time is reached by advancing from zero rather than by moving a clock, so a scrub, a
 * screenshot and a snapshot over the pool all agree (decision 2.6 of
 * docs/plans/vfx-particle-renderer.md). The variable stepper is what the first tiers
 * run on, and the interface it satisfies is where a fixed-rate one drops in.
 *
 * The rig is the driver's rather than the model's, per decision 2.9, and it holds
 * nothing about when it was bound: where a run stands is read off the clock, so the
 * replay above reaches what a play reaches. The rig also faces the system, the way the
 * engine yaws a missile toward its target, and the definition's own transform is the
 * outermost factor of everything the rig places.
 */
export function createDriver(seed: number): Driver {
  const pool = createPool(POOL_CAP);
  const stepper: Stepper = variableStepper();
  let system = emptySystem(null);
  let span = systemSpan(system);
  let tail = lingerTail(system);
  let world = worldOf(system);
  let rig: RigModel = FIRST_RIG.rig;
  let rng = new Rng(seed);
  let states: EmitterState[] = [];
  const yaw = new Float32Array(FRAME_SLOTS);
  const orientation = new Float32Array(FRAME_SLOTS);
  const lineage = createLineage(seed);
  lineage.joints = rig.joints ?? null;
  const children = createChildren(lineage, "", 0);
  const lanes = createLanes();

  /** The run's checkpoints, which a seek starts from. */
  const marks = createCheckpoints<Checkpoint>(MOST_MARKS, CHECKPOINT_BYTES);

  /** How far into its run the last step stood, which a wrap back past it is a loop. */
  let phase = 0;

  /** Where the origin stood at the end of the last step, so a step knows its own travel. */
  let origin: Point = originAt(rig.motion, 0, rig.height);

  relane();

  function run(frameTime: number): void {
    for (const step of stepper.advance(frameTime)) {
      const reached = phaseAt(rig, step.now, span, tail);
      if (reached < phase) replay();
      phase = reached;

      const now = originAt(rig.motion, reached, rig.height);
      /* A path stands in for a missile's own game object, whose travel is its local `Y`,
         where a unit's system is the look-at yaw of question 11. */
      orientInto(reached);
      const placed: SystemStep = {
        dt: step.dt,
        now: step.now,
        origin: place(world, now),
        moved: turn(world, displacement(origin, now)),
        yaw,
        world: world.basis,
        stopped: (rig.stopAt != null && reached >= rig.stopAt) || landed(rig.motion, reached),
        pinned: lineage.pinned,
      };

      stepEmitters(pool, system, placed, rng, states);
      origin = now;
      children.step(driver, system, step.dt, step.now);
      lanes.tally(pool, reached);
      keep(step.now);
    }
  }

  /** The lanes sized for the emitters drawn and the run they are drawn over. */
  function relane(): void {
    lanes.resize(system.emitters.length, runLength(rig.motion, span, tail));
  }

  /** The run at `now` as a value, deep copied. */
  function capture(now: number): Checkpoint {
    const rows = copyRows(pool);
    const snapshot = children.snapshot();
    return {
      time: now,
      step: Math.round(now / SEEK_STEP),
      rows,
      states: copyEmitterStates(states),
      rng: rng.clone(),
      phase,
      origin,
      children: snapshot,
      births: lineage.births.slice(),
      bytes: rowsByteLength(rows) + snapshotByteLength(snapshot),
    };
  }

  /** Keep the run at `now` where the quarter-second mark it has crossed holds none. */
  function keep(now: number): void {
    const at = Math.floor(now / MARK);
    if (!marks.wants(at)) return;
    const bytes = liveByteLength(pool) + children.byteLength();
    marks.keep(at, bytes, () => capture(now));
  }

  /** The latest checkpoint at or before seek step `step`, and null for a time holding none. */
  function checkpointAt(step: number): Checkpoint | null {
    return marks.latest(Math.floor((step * SEEK_STEP) / MARK), step);
  }

  /**
   * Stand the run where `held` stands.
   *
   * The rows are written into the pool rather than replacing it, which keeps the object
   * every draw holds.
   */
  function restore(held: Checkpoint): void {
    writeRows(pool, held.rows);
    stepper.reset(held.time);
    rng = held.rng.clone();
    states = copyEmitterStates(held.states);
    phase = held.phase;
    origin = held.origin;
    children.restore(held.children);
    lineage.births.length = 0;
    for (const birth of held.births) lineage.births.push(birth);
    orientInto(phase);
  }

  /**
   * The rig's own turn at `reached`, into the yaw and the orientation beside it.
   *
   * A path stands in for a missile's own game object, whose travel is its local `Y`,
   * where a unit's system is the look-at yaw of question 11. A bone takes its joint's whole
   * turn, as a system attached to a bone does.
   */
  function orientInto(reached: number): void {
    const motion = rig.motion;
    if (motion.kind === "bone") motion.anchor.basisInto(reached, yaw);
    else if (motion.kind === "path") flightInto(facingAt(motion, reached), yaw);
    else yawInto(facingAt(motion, reached), yaw);
    multiplyInto(world.basis, yaw, orientation);
  }

  /* A loop starts the effect over without touching the seed, so the run stays one
     stream and a seek that crosses the boundary reproduces both passes. */
  function replay(): void {
    pool.count = 0;
    children.clear();
    lineage.births.length = 0;
    states = createEmitterStates(system.emitters);
    origin = originAt(rig.motion, 0, rig.height);
    lanes.wrap();
  }

  /* The serials start over with the stream, because a child's own stream is seeded off the
     serial of the particle it rides and a seek has to reach the children a play reaches. */
  function rewind(): void {
    pool.count = 0;
    pool.born = 0;
    children.clear();
    lineage.births.length = 0;
    rng = new Rng(seed);
    stepper.reset();
    states = createEmitterStates(system.emitters);
    phase = 0;
    origin = originAt(rig.motion, 0, rig.height);
    orientInto(0);
    relane();
  }

  const driver: Driver = {
    pool,
    get time() {
      return stepper.now;
    },
    get elapsed() {
      return phaseAt(rig, stepper.now, span, tail);
    },
    get origin() {
      return place(world, origin);
    },
    get target() {
      return place(world, targetAt(rig.motion, phaseAt(rig, stepper.now, span, tail), rig.height));
    },
    get orientation() {
      return orientation;
    },
    histogram: lanes,
    advance: run,
    seek(time) {
      const wanted = Math.min(Math.max(time, 0), SEEK_STEPS * SEEK_STEP);
      const steps = Math.round(wanted / SEEK_STEP);
      const from = checkpointAt(steps);
      if (from === null) rewind();
      else restore(from);

      for (let at = from?.step ?? 0; at < steps; at += 1) run(SEEK_STEP);
      lanes.reach(phaseAt(rig, stepper.now, span, tail));
    },
    restart: rewind,

    /* A checkpoint holds births drawn under the last pin, so a seek replays from the new one. */
    pin(chance) {
      lineage.pinned = chance;
      marks.clear();
    },

    /*
     * Decision 2.5: an edit replaces the definition the emitters point at and the
     * particle pool is not consulted, so a live particle keeps its birth values and its
     * position and the next appearance pass reads the new definition. An edit that moves
     * what an index addresses is the one case that restarts, because the pool's `emitter`
     * column would otherwise evaluate a live particle against another emitter's curves.
     * A child follows the same rule one level down.
     */
    swap(next) {
      const same = addressTheSame(system.emitters, next.emitters);
      system = next;
      span = systemSpan(next);
      tail = lingerTail(next);
      world = worldOf(next);
      /* The span is the run a still rig loops on, so the phase moves with an edit for the
         same reason it moves with a tune. */
      phase = phaseAt(rig, stepper.now, span, tail);
      orientInto(phase);
      marks.clear();
      relane();
      if (same) {
        children.repoint(next);
        return;
      }

      states = createEmitterStates(next.emitters);
      pool.count = 0;
      children.clear();
      lineage.births.length = 0;
    },

    /*
     * Asking for a different motion is asking to watch a different thing, so it restarts
     * rather than dropping the effect part-way along a path it never travelled. Tuning
     * one holds the run, and only re-reads the origin, so a drag along a slider moves
     * what it is describing rather than pinning the run to its first frame.
     */
    steer(next) {
      const turned = next.motion.kind !== rig.motion.kind;
      rig = next;
      lineage.joints = next.joints ?? null;
      marks.clear();

      if (turned) {
        rewind();
        return;
      }
      /* The phase moves with the rig, because a tune that shortens the run wraps it back
         below what the last step reached and the next step would read that as a loop. */
      phase = phaseAt(next, stepper.now, span, tail);
      origin = originAt(next.motion, phase, next.height);
      orientInto(phase);
      relane();
    },

    sources(path) {
      return feedOf(lineage, path);
    },

    liveChildren() {
      return lineage.live;
    },

    births() {
      return lineage.births;
    },
  };
  return driver;
}

/** `point` under the world's basis and offset. */
function place(world: World, point: Point): Point {
  const turned = turn(world, point);
  return [turned[0] + world.offset[0], turned[1] + world.offset[1], turned[2] + world.offset[2]];
}

/** `vector` under the world's basis alone. */
function turn(world: World, vector: Point): Point {
  TURNED.set(vector);
  turnInto(world.basis, TURNED, 0);
  return [TURNED[0], TURNED[1], TURNED[2]];
}

const TURNED = new Float32Array(3);
