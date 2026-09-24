import type { Pool } from "../../engine/simulation/pool";

/**
 * A pool's live particles grouped by emitter, each group in pool order.
 *
 * The particles of emitter `e` are `order[starts[e]]` up to `order[starts[e + 1]]`.
 */
export interface EmitterBuckets {
  readonly starts: Int32Array;
  readonly order: Int32Array;
  /** How many emitters `starts` covers, past which an emitter has no particles. */
  readonly emitters: number;
}

interface Built {
  stamp: number;
  count: number;
  starts: Int32Array;
  order: Int32Array;
  emitters: number;
}

const BUILT = new WeakMap<Pool, Built>();

/**
 * `pool`'s buckets for the frame `stamp` names, built by the first draw path that asks.
 *
 * Every draw path of a system reads the same pool, so one counting pass per frame replaces
 * one scan of the whole pool per emitter. `stamp` is the renderer's frame counter, which
 * no draw path's frame callback moves.
 */
export function bucketsOf(pool: Pool, stamp: number): EmitterBuckets {
  let built = BUILT.get(pool);
  if (built !== undefined && built.stamp === stamp && built.count === pool.count) return built;

  if (built === undefined) {
    built = { stamp, count: 0, starts: new Int32Array(1), order: new Int32Array(0), emitters: 0 };
    BUILT.set(pool, built);
  }
  built.stamp = stamp;
  built.count = pool.count;

  let emitters = 0;
  for (let at = 0; at < pool.count; at += 1) emitters = Math.max(emitters, pool.emitter[at] + 1);
  if (built.starts.length < emitters + 1) built.starts = new Int32Array(emitters + 1);
  if (built.order.length < pool.count) built.order = new Int32Array(pool.capacity);
  built.emitters = emitters;

  const { starts, order } = built;
  starts.fill(0, 0, emitters + 1);
  for (let at = 0; at < pool.count; at += 1) {
    const emitter = pool.emitter[at];
    if (emitter >= 0) starts[emitter + 1] += 1;
  }
  for (let emitter = 0; emitter < emitters; emitter += 1) starts[emitter + 1] += starts[emitter];

  /* Filled from each group's start, which leaves `starts` shifted one group on, so the
     shift is undone after. */
  for (let at = 0; at < pool.count; at += 1) {
    const emitter = pool.emitter[at];
    if (emitter < 0) continue;

    order[starts[emitter]] = at;
    starts[emitter] += 1;
  }
  for (let emitter = emitters; emitter > 0; emitter -= 1) starts[emitter] = starts[emitter - 1];
  starts[0] = 0;

  return built;
}

/** The range of `buckets.order` that contains `emitter`'s particles, empty for one with none. */
export function bucketRange(buckets: EmitterBuckets, emitter: number): [number, number] {
  if (emitter < 0 || emitter >= buckets.emitters) return EMPTY;
  return [buckets.starts[emitter], buckets.starts[emitter + 1]];
}

const EMPTY: [number, number] = [0, 0];
