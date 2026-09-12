import { fnv1a32 } from "../binHash";
import {
  BEARING,
  type Bearing,
  bearingInto,
  copySeen,
  type Seen,
  seenAt,
  standAt,
} from "./childBearing";
import { capacityOf, givePool, takePool } from "./childPool";
import {
  copyEmitterStates,
  createEmitterStates,
  type EmitterState,
  stepEmitters,
  type SystemStep,
  type World,
  worldOf,
} from "./integrate";
import type { ChildSetModel, EmitterModel, InheritanceModel, SystemModel } from "./model";
import { type DrawFrame, frameOf, type Source } from "./particleRead";
import {
  copyRows,
  FRAME_SLOTS,
  liveByteLength,
  type Pool,
  type PoolRows,
  rowsByteLength,
  writeRows,
} from "./pool";
import type { Anchor, Joints, Point } from "./rig";
import { Rng } from "./Rng";
import { drawCurve, sampleCurve } from "./sampleCurve";
import { addressTheSame, systemSpan } from "./systemModel";

/**
 * How deep a child nests under the system the viewport opened, past which a set spawns none.
 *
 * The engine bounds neither recursion nor cycles, so the cap is the renderer's own.
 */
export const MAX_CHILD_DEPTH = 4;

/** How many children may be live at once, across every depth. */
const MAX_CHILDREN = 512;

/** How many particles the live children together hold room for. */
const CHILD_BUDGET = 1 << 17;

/**
 * The path of the child at `slot` of `emitter`'s set, under a parent whose paths start `prefix`.
 *
 * `3.0` is the first child of emitter 3, and a deeper child adds its own after a slash,
 * `3.0/1.0`, so one path is one definition.
 */
export function childPath(prefix: string, emitter: number, slot: number): string {
  return `${prefix}${emitter}.${slot}`;
}

/** The prefix the children of the child at `path` start their own paths with. */
export function childPrefix(path: string): string {
  return `${path}/`;
}

/** One child a run spawned: which definition, off which emitter, and when. */
export interface ChildBirth {
  readonly path: string;
  readonly emitter: number;
  readonly slot: number;
  /** Seconds on the driver's clock at the spawn. */
  readonly bornAt: number;
  /** Nesting under the opened system, 1 for its own emitters' children. */
  readonly depth: number;
}

/** How many births one pass logs, past which a spawn goes unnamed. */
const MOST_BIRTHS = 4096;

/** What every child of one viewport's system shares: the lists a draw reads, the pools and the caps. */
export interface Lineage {
  readonly seed: number;
  /** The live children of each definition path, which the draw of that definition reads. */
  readonly feeds: Map<string, Source[]>;
  /** Pools a reaped child left, by capacity, which the next child of that size takes. */
  readonly spare: Map<number, Pool[]>;
  /** Every child this pass has spawned, which the timeline's child lanes read. */
  readonly births: ChildBirth[];
  /** How many particles the live children hold room for, against `CHILD_BUDGET`. */
  held: number;
  /** How many children are live, against `MAX_CHILDREN`. */
  live: number;
  /** The skeleton a bone set's children resolve their joints on, null for a rig carrying none. */
  joints: Joints | null;
  /** The chance the reader pins every birth of the run at, null for a run left to its draws. */
  pinned: number | null;
}

/** A lineage with no children in it, seeded off the viewport's own seed, riding no skeleton. */
export function createLineage(seed: number): Lineage {
  return {
    seed,
    feeds: new Map(),
    spare: new Map(),
    births: [],
    held: 0,
    live: 0,
    joints: null,
    pinned: null,
  };
}

/** The live list of the children at `path`, which the lineage keeps current in place. */
export function feedOf(lineage: Lineage, path: string): Source[] {
  let feed = lineage.feeds.get(path);
  if (feed === undefined) {
    feed = [];
    lineage.feeds.set(path, feed);
  }
  return feed;
}

/** The children of one system: every live one, and what the next step spawns. */
export interface Children {
  /** Follow, step, reap and spawn the children of `system`, whose own step `parent` has just taken. */
  step(parent: Source, system: SystemModel, dt: number, now: number): void;
  /** Point every child at the definition it holds in `next`, dropping one `next` no longer holds. */
  repoint(next: SystemModel): void;
  /** Drop every child, which is what a restart does to the pool they ride. */
  clear(): void;
  /** Every live child as a value, deep copied, which a checkpoint holds. */
  snapshot(): ChildrenSnapshot;
  /** Stand the children where `held` stands, in place of whatever is live. */
  restore(held: ChildrenSnapshot): void;
  readonly count: number;
  /** The bytes a snapshot would hold, at every depth, without taking one. */
  byteLength(): number;
}

/** The children of one system as a value, which a checkpoint holds and a seek restores. */
export interface ChildrenSnapshot {
  readonly children: readonly ChildCopy[];
  /** The death-spawning particles carried between steps, by serial. */
  readonly seen: readonly (readonly [number, Seen])[];
  /** How far the spawn sweep had read the parent pool's births. */
  readonly cursor: number;
}

/** One live child system: a pool and emitters of its own, riding the particle that spawned it. */
export interface Child extends Source {
  system: SystemModel;
  readonly path: string;
  /** The parent emitter's index and the child's place in its set, which a repoint looks up. */
  readonly emitter: number;
  readonly slot: number;
  readonly pool: Pool;
  readonly capacity: number;
  states: EmitterState[];
  readonly rng: Rng;
  readonly bornAt: number;
  /** The serial of the particle it rides, and null for a child no particle carries. */
  serial: number | null;
  /** When a child no particle carries stops, and null for one its particle's death stops. */
  readonly stopAt: number | null;
  stopped: boolean;
  time: number;
  elapsed: number;
  readonly origin: [number, number, number];
  /** Where the origin stood at the end of the last step, so a step knows its own travel. */
  readonly from: [number, number, number];
  target: Point;
  /** The particle's own turn, unscaled, which is the child system's orientation. */
  readonly yaw: Float32Array;
  readonly orientation: Float32Array;
  world: World;
  inheritance: InheritanceModel | null;
  /** The joint a bone child rides, re-sampled every step it follows, and null off a bone. */
  readonly anchor: Anchor | null;
  readonly children: Children;
}

/** One live child as a value: its pool's live rows, its own state, and its own children. */
interface ChildCopy extends Omit<Child, "pool" | "states" | "children"> {
  readonly rows: PoolRows;
  readonly states: readonly EmitterState[];
  readonly children: ChildrenSnapshot;
}

/** One child owed: which set spawns it, off which particle, and at what point of that life. */
interface Birth {
  readonly set: ChildSetModel;
  readonly emitter: number;
  readonly serial: number;
  /** When in the particle's life the index is read: zero at a birth, the lifetime at a death. */
  readonly time: number;
  /** A carried child follows its particle, and a loose one stands where it was spawned. */
  readonly ride: "carried" | "loose";
}

/**
 * The children of one system at `depth`, whose paths all start with `prefix`.
 *
 * A child is created after its parent's step, for every particle born since the last,
 * and is first stepped on the step after. It follows its particle live until the
 * particle dies, when it is stopped and left where it stood, and is reaped once it has
 * played out. A death spawn is the replacement: created as the particle dies, at its
 * last transform, and never following anything.
 */
export function createChildren(lineage: Lineage, prefix: string, depth: number): Children {
  const mine: Child[] = [];
  const bySerial = new Map<number, number>();
  const carried = new Set<number>();
  const seen = new Map<number, Seen>();
  let cursor = 0;

  function release(index: number): void {
    const child = mine[index];
    mine.splice(index, 1);
    const feed = lineage.feeds.get(child.path);
    const listed = feed?.indexOf(child) ?? -1;
    if (feed !== undefined && listed >= 0) feed.splice(listed, 1);
    child.children.clear();
    givePool(lineage, child.pool, child.capacity);
    lineage.live -= 1;
    lineage.held -= child.capacity;
  }

  /**
   * One particle's owed children, off `birth.set`: the one a bone-less set's probability
   * picks, or all N of a bone set's, each off its own bone and its own stream.
   */
  function spawn(birth: Birth, now: number, parent: Source, bearing: Bearing): void {
    const { set, emitter, serial } = birth;

    if (set.bones.length === 0) {
      const rng = new Rng(seedOf(lineage.seed, `${prefix}${emitter}`, serial));
      const slot = childIndex(set, birth.time, () => rng.unitFloat());
      if (slot !== null) spawnChild(birth, slot, now, parent, bearing, rng, null);
      return;
    }

    const joints = lineage.joints;
    if (joints === null) return;
    const count = boneChildCount(set);
    for (let slot = 0; slot < count; slot += 1) {
      const anchor = joints(set.bones[slot]);
      if (anchor === null) continue;
      const path = childPath(prefix, emitter, slot);
      const rng = new Rng(seedOf(lineage.seed, path, serial));
      spawnChild(birth, slot, now, parent, bearing, rng, anchor);
    }
  }

  function spawnChild(
    birth: Birth,
    slot: number,
    now: number,
    parent: Source,
    bearing: Bearing,
    rng: Rng,
    anchor: Anchor | null,
  ): void {
    const { set, emitter, serial } = birth;
    const system = set.children[slot] ?? null;
    if (system === null) return;

    const capacity = capacityOf(system);
    if (lineage.live >= MAX_CHILDREN || lineage.held + capacity > CHILD_BUDGET) return;

    const path = childPath(prefix, emitter, slot);
    const carried = birth.ride === "carried";
    const child: Child = {
      system,
      path,
      emitter,
      slot,
      pool: takePool(lineage, capacity),
      capacity,
      states: createEmitterStates(system.emitters),
      rng,
      bornAt: now,
      serial: carried ? serial : null,
      stopAt: carried ? null : now + systemSpan(system),
      stopped: false,
      time: now,
      elapsed: 0,
      origin: [0, 0, 0],
      from: [0, 0, 0],
      target: parent.target,
      yaw: new Float32Array(FRAME_SLOTS),
      orientation: new Float32Array(FRAME_SLOTS),
      world: worldOf(system),
      inheritance: set.inheritance,
      anchor,
      children: createChildren(lineage, childPrefix(path), depth + 1),
    };
    standAt(child, bearing, now);
    child.from[0] = child.origin[0];
    child.from[1] = child.origin[1];
    child.from[2] = child.origin[2];

    mine.push(child);
    feedOf(lineage, path).push(child);
    lineage.live += 1;
    lineage.held += capacity;
    if (lineage.births.length < MOST_BIRTHS) {
      lineage.births.push({ path, emitter, slot, bornAt: now, depth: depth + 1 });
    }
  }

  return {
    step(parent, system, dt, now) {
      const pool = parent.pool;
      const emitters = system.emitters;
      const sets = emitters.map((emitter) => spawning(emitter, depth));
      if (mine.length === 0 && seen.size === 0 && sets.every((set) => set === null)) {
        cursor = pool.born;
        return;
      }

      /* The serials the step looks up are the carried children's and the death-spawners'
         last seen, a few hundred at most, so one walk of the pool indexes those alone. */
      bySerial.clear();
      carried.clear();
      for (const child of mine) {
        if (child.serial !== null) carried.add(child.serial);
      }
      if (carried.size > 0 || seen.size > 0) {
        for (let at = 0; at < pool.count; at += 1) {
          const serial = pool.serial[at];
          if (carried.has(serial) || seen.has(serial)) bySerial.set(serial, at);
        }
      }

      /* Each emitter's frame is the same for every particle of the step, so it is read
         once per emitter rather than per particle. */
      const frames: (DrawFrame | undefined)[] = [];
      const frameAt = (index: number): DrawFrame => {
        const held = frames[index] ?? frameOf(parent, emitters[index]);
        frames[index] = held;
        return held;
      };

      for (const child of mine) {
        child.target = parent.target;
        if (child.serial === null) continue;
        const at = bySerial.get(child.serial);
        if (at === undefined) {
          child.serial = null;
          child.stopped = true;
          continue;
        }
        const index = pool.emitter[at];
        bearingInto(parent, emitters[index], frameAt(index), at, child.inheritance, BEARING);
        standAt(child, BEARING, now);
      }

      for (const child of mine) advance(child, dt, now, lineage.pinned);
      for (let index = mine.length - 1; index >= 0; index -= 1) {
        if (playedOut(mine[index])) release(index);
      }

      for (const [serial, last] of seen) {
        if (bySerial.has(serial)) continue;
        seen.delete(serial);
        const set = sets[last.emitter] ?? null;
        if (!set?.onDeath) continue;
        const birth: Birth = {
          set,
          emitter: last.emitter,
          serial,
          time: last.lifetime,
          ride: "loose",
        };
        spawn(birth, now, parent, last);
      }

      for (let at = 0; at < pool.count; at += 1) {
        const index = pool.emitter[at];
        const set = sets[index] ?? null;
        if (set === null) continue;
        const serial = pool.serial[at];

        if (set.onDeath) {
          let last = seen.get(serial);
          if (last === undefined) {
            last = seenAt(index);
            seen.set(serial, last);
          }
          last.lifetime = pool.lifetime[at];
          bearingInto(parent, emitters[index], frameAt(index), at, set.inheritance, last);
          continue;
        }

        if (serial < cursor) continue;
        bearingInto(parent, emitters[index], frameAt(index), at, set.inheritance, BEARING);
        spawn({ set, emitter: index, serial, time: 0, ride: "carried" }, now, parent, BEARING);
      }
      cursor = pool.born;
    },

    repoint(next) {
      for (let index = mine.length - 1; index >= 0; index -= 1) {
        const child = mine[index];
        const set = next.emitters[child.emitter]?.childSet ?? null;
        const fresh = set?.children[child.slot] ?? null;
        if (set === null || fresh === null) {
          release(index);
          continue;
        }
        if (!addressTheSame(child.system.emitters, fresh.emitters)) {
          release(index);
          continue;
        }
        child.system = fresh;
        child.world = worldOf(fresh);
        child.inheritance = set.inheritance;
        child.children.repoint(fresh);
      }
    },

    clear() {
      for (let index = mine.length - 1; index >= 0; index -= 1) release(index);
      seen.clear();
      bySerial.clear();
      cursor = 0;
    },

    snapshot() {
      return {
        children: mine.map(copyChild),
        seen: [...seen].map(([serial, last]) => [serial, copySeen(last)] as const),
        cursor,
      };
    },

    /* A release returns each live child's pool to the spare and takes it out of its feed,
       which the rebuilt children enter again. The feed arrays are the ones a draw holds. */
    restore(held) {
      for (let index = mine.length - 1; index >= 0; index -= 1) release(index);
      for (const copy of held.children) mine.push(standChild(lineage, copy, depth + 1));

      seen.clear();
      for (const [serial, last] of held.seen) seen.set(serial, copySeen(last));
      bySerial.clear();
      cursor = held.cursor;
    },

    get count() {
      return mine.length;
    },

    byteLength() {
      let bytes = 0;
      for (const child of mine) {
        bytes += liveByteLength(child.pool) + child.yaw.byteLength + child.orientation.byteLength;
        bytes += child.children.byteLength();
      }
      for (const [, last] of seen) bytes += last.place.byteLength + last.yaw.byteLength;
      return bytes;
    },
  };
}

/** `child` as a value, its arrays deep copied and its stream standing where it stands. */
function copyChild(child: Child): ChildCopy {
  return {
    system: child.system,
    path: child.path,
    emitter: child.emitter,
    slot: child.slot,
    capacity: child.capacity,
    rows: copyRows(child.pool),
    states: copyEmitterStates(child.states),
    rng: child.rng.clone(),
    bornAt: child.bornAt,
    serial: child.serial,
    stopAt: child.stopAt,
    stopped: child.stopped,
    time: child.time,
    elapsed: child.elapsed,
    origin: [...child.origin],
    from: [...child.from],
    target: child.target,
    yaw: child.yaw.slice(),
    orientation: child.orientation.slice(),
    world: child.world,
    inheritance: child.inheritance,
    anchor: child.anchor,
    children: child.children.snapshot(),
  };
}

/** A child standing where `copy` stands, on a pool of its own and back in its feed. */
function standChild(lineage: Lineage, copy: ChildCopy, depth: number): Child {
  const pool = takePool(lineage, copy.capacity);
  writeRows(pool, copy.rows);
  const children = createChildren(lineage, childPrefix(copy.path), depth);
  children.restore(copy.children);

  const child: Child = {
    system: copy.system,
    path: copy.path,
    emitter: copy.emitter,
    slot: copy.slot,
    pool,
    capacity: copy.capacity,
    states: copyEmitterStates(copy.states),
    rng: copy.rng.clone(),
    bornAt: copy.bornAt,
    serial: copy.serial,
    stopAt: copy.stopAt,
    stopped: copy.stopped,
    time: copy.time,
    elapsed: copy.elapsed,
    origin: [...copy.origin],
    from: [...copy.from],
    target: copy.target,
    yaw: copy.yaw.slice(),
    orientation: copy.orientation.slice(),
    world: copy.world,
    inheritance: copy.inheritance,
    anchor: copy.anchor,
    children,
  };

  feedOf(lineage, copy.path).push(child);
  lineage.live += 1;
  lineage.held += copy.capacity;
  return child;
}

/** The bytes `snapshot` holds in its arrays, at every depth of the lineage under it. */
export function snapshotByteLength(snapshot: ChildrenSnapshot): number {
  let bytes = 0;
  for (const copy of snapshot.children) {
    bytes += rowsByteLength(copy.rows) + copy.yaw.byteLength + copy.orientation.byteLength;
    bytes += snapshotByteLength(copy.children);
  }
  for (const [, last] of snapshot.seen) bytes += last.place.byteLength + last.yaw.byteLength;
  return bytes;
}

/**
 * Which of `set`'s children one particle spawns where it names no bones, and null for a
 * set that spawns none.
 *
 * The index, with `draw` asked for a chance only where the index is read. A bone set
 * spawns one child per bone instead, off the lineage's own joints.
 */
export function childIndex(set: ChildSetModel, time: number, draw: () => number): number | null {
  const count = set.children.length;
  if (count === 0 || set.bones.length > 0) return null;
  if (count === 1) return 0;

  const value =
    set.probability.tables.length === 0
      ? sampleCurve(set.probability, time)[0]
      : drawCurve(set.probability, time, draw())[0];
  return Math.trunc(Math.max(0, value ?? 0)) % count;
}

/** How many children a bone set spawns: one per bone, and none where there are too few. */
function boneChildCount(set: ChildSetModel): number {
  return set.bones.length >= set.children.length ? set.children.length : 0;
}

/** One step of a child, then of its own children, the way the driver steps the root. */
function advance(child: Child, dt: number, now: number, pinned: number | null): void {
  child.time = now;
  child.elapsed = now - child.bornAt;
  if (child.stopAt !== null && now >= child.stopAt) child.stopped = true;

  const step: SystemStep = {
    dt,
    now,
    origin: child.origin,
    moved: [
      child.origin[0] - child.from[0],
      child.origin[1] - child.from[1],
      child.origin[2] - child.from[2],
    ],
    yaw: child.yaw,
    world: child.world.basis,
    stopped: child.stopped,
    pinned,
  };
  stepEmitters(child.pool, child.system, step, child.rng, child.states);
  child.children.step(child, child.system, dt, now);

  child.from[0] = child.origin[0];
  child.from[1] = child.origin[1];
  child.from[2] = child.origin[2];
}

/**
 * The child has nothing left to draw and nothing left to spawn.
 *
 * A stopped child plays its particles out, and a running one is done where every emitter
 * has finished on its own, which the engine treats as nulling the slot.
 */
function playedOut(child: Child): boolean {
  if (child.pool.count > 0 || child.children.count > 0) return false;
  if (child.stopped) return true;

  return child.system.emitters.every((emitter, index) => {
    const state = child.states[index];
    return (
      emitter.disabled ||
      (emitter.singleParticle && state.emitted) ||
      (emitter.lifetime !== null && state.age > emitter.lifetime)
    );
  });
}

/** The set an emitter's particles spawn, and null for one that spawns none at `depth`. */
function spawning(emitter: EmitterModel, depth: number): ChildSetModel | null {
  if (emitter.disabled || depth >= MAX_CHILD_DEPTH) return null;
  return emitter.childSet;
}

/** A child's own stream, off the viewport's seed, its place in the tree and its particle's serial. */
function seedOf(seed: number, place: string, serial: number): number {
  return (seed ^ fnv1a32(place) ^ Math.imul(serial + 1, 0x9e3779b1)) | 0;
}
