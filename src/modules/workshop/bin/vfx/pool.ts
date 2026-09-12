/**
 * Every live particle of a system, one index per particle across parallel arrays.
 *
 * The live particles are packed at the front, so a draw is one contiguous range and a
 * pass walks `count` entries rather than testing each for life. The engine's own pool
 * grows every array in the same call for the same reason.
 */
export interface Pool {
  readonly capacity: number;
  /** How many particles are live, which is where the packed range ends. */
  count: number;
  /** How many particles have ever been born, which is the next serial. */
  born: number;
  /** Which emitter of the system the particle belongs to. */
  readonly emitter: Int32Array;
  /**
   * The particle's place in birth order across the whole pool.
   *
   * A retire moves the last particle into the freed slot, so the pool's own order says
   * nothing about age. A trail strings an emitter's particles along by this instead.
   */
  readonly serial: Uint32Array;
  readonly birthTime: Float32Array;
  readonly lifetime: Float32Array;
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  /**
   * How fast the particle actually moved over the last step, three per particle.
   *
   * The frame displacement divided by `dt`, and zero for a particle born during the step.
   * It is what a direction-oriented particle aims along and what a velocity colour lookup
   * reads, and it carries the emitter's own drift and drag where the stored velocity does
   * not.
   */
  readonly travel: Float32Array;
  readonly birthScale: Float32Array;
  /**
   * The basis the particle was born in, nine per particle, row-major in the engine's
   * space: the emitter's overrides under the system's orientation, which the particle's
   * own rotation stands on and its local terms are turned by.
   */
  readonly frame: Float32Array;
  /** Euler degrees the quad stands at, seeded at birth and turned by the integrator. */
  readonly rotation: Float32Array;
  /** `birthRotationalVelocity0` and `birthRotationalAcceleration0`, degrees a second, three per particle. */
  readonly angularVelocity: Float32Array;
  readonly angularAcceleration: Float32Array;
  /** `birthDrag`, three per particle, which the integrator sums into the emitter's drag. */
  readonly birthDrag: Float32Array;
  /** Where each axis eases out to under `kAnalyticDragMotion`, the engine's `aux[4..6]`. */
  readonly dragTerminal: Float32Array;
  /** What of `dragTerminal` is still to travel, three per particle, the engine's `aux[7..9]`. */
  readonly dragOffset: Float32Array;
  /**
   * `birthOrbitalVelocity`, radians a second, three per particle.
   *
   * Held rather than accumulated, because the angle is the rate times the age and the turn
   * it builds is applied to the particle's place as well as its basis.
   */
  readonly orbital: Float32Array;
  readonly birthColor: Float32Array;
  /** The particle's own `[0, 1)` draw, which the appearance of a shared random reads. */
  readonly roll: Float32Array;
  /** When the particle's emitter finished, and [`NOT_LINGERING`] while it has not. */
  readonly lingerFrom: Float32Array;
  /**
   * `mBirthTilingSize` as drawn at birth, two per particle, which a trail or a beam
   * spans its texture by.
   *
   * The engine's `mBirthTilingSizeForTrailOrBeam`, which stores the x and y and drops the
   * z.
   */
  readonly tiling: Float32Array;
  /**
   * How far the emitter's spawn point had travelled when the particle was born.
   *
   * The engine's `mTrailLength`, which is not a length of trail but the emitter's
   * odometer at the birth. A `WAKE` trail runs its `u` on it, so the texture is pinned to
   * the path.
   */
  readonly odometer: Float32Array;
  /**
   * Each texture layer's own UV state, [`UV_SLOTS`] per layer and [`UV_LAYERS`] of them.
   *
   * The scroll and the rotation accumulate here rather than being read off the age,
   * because both are driven by `IntegratedValue` rates that vary over a particle's life.
   */
  readonly uv: Float32Array;
}

/** How many layers a particle carries: its texture, and `textureMult` over it. */
export const UV_LAYERS = 2;

/** What `lingerFrom` holds for a particle whose emitter is still running. */
export const NOT_LINGERING = -1;

/** Where one layer's own numbers sit, from `index * UV_LAYERS * UV_SLOTS + layer * UV_SLOTS`. */
export const UV = {
  /** The integrated scroll alone, which opens at zero. */
  scrollX: 0,
  scrollY: 1,
  /** `birthUVOffset`, where the birth ramp opens. */
  birthOffsetX: 2,
  birthOffsetY: 3,
  /** `birthUvScrollRate`, which the ramp climbs at over the particle's age. */
  birthScrollX: 4,
  birthScrollY: 5,
  /** The integrated rotation alone, in degrees. */
  rotate: 6,
  /** `birthUvRotateRate`, degrees a second over the particle's age. */
  birthRotate: 7,
  /** How far into its run the book opened, in cells, which a random start draws. */
  phase: 8,
  /** Cells a second, which is the emitter's rate times the particle's own multiplier. */
  frameRate: 9,
} as const;

/** How many numbers one layer takes. */
export const UV_SLOTS = 10;

/** How many numbers a particle's frame takes, a 3x3. */
export const FRAME_SLOTS = 9;

const IDENTITY_FRAME = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** A pool holding room for `capacity` particles and no live ones. */
export function createPool(capacity: number): Pool {
  return {
    capacity,
    count: 0,
    born: 0,
    emitter: new Int32Array(capacity),
    serial: new Uint32Array(capacity),
    birthTime: new Float32Array(capacity),
    lifetime: new Float32Array(capacity),
    position: new Float32Array(capacity * 3),
    velocity: new Float32Array(capacity * 3),
    travel: new Float32Array(capacity * 3),
    birthScale: new Float32Array(capacity * 3),
    frame: new Float32Array(capacity * FRAME_SLOTS),
    rotation: new Float32Array(capacity * 3),
    angularVelocity: new Float32Array(capacity * 3),
    angularAcceleration: new Float32Array(capacity * 3),
    birthDrag: new Float32Array(capacity * 3),
    dragTerminal: new Float32Array(capacity * 3),
    dragOffset: new Float32Array(capacity * 3),
    orbital: new Float32Array(capacity * 3),
    birthColor: new Float32Array(capacity * 4),
    roll: new Float32Array(capacity),
    lingerFrom: new Float32Array(capacity),
    tiling: new Float32Array(capacity * 2),
    odometer: new Float32Array(capacity),
    uv: new Float32Array(capacity * UV_LAYERS * UV_SLOTS),
  };
}

/** One column of a pool: the same numbers for every particle, packed. */
type Column = Int32Array | Uint32Array | Float32Array;

/**
 * The live rows of a pool as a value, which a checkpoint holds and a restore writes back.
 *
 * The live range alone rather than the whole capacity, which a root pool has 32,768 of.
 */
export interface PoolRows {
  readonly count: number;
  readonly born: number;
  /** Each column's live prefix, in the order [`createPool`] lays the columns out. */
  readonly columns: readonly Column[];
}

/** Every column of `pool`, which is each of its fields that is not a count. */
function columnsOf(pool: Pool): Column[] {
  return Object.values(pool).filter((held): held is Column => typeof held !== "number");
}

/** The live rows of `pool`, deep copied. */
export function copyRows(pool: Pool): PoolRows {
  const columns = columnsOf(pool).map((column) =>
    column.slice(0, pool.count * (column.length / pool.capacity)),
  );
  return { count: pool.count, born: pool.born, columns };
}

/** The bytes `rows` holds over every column. */
export function rowsByteLength(rows: PoolRows): number {
  return rows.columns.reduce((sum, column) => sum + column.byteLength, 0);
}

/** The bytes a copy of `pool`'s live rows would hold, without taking one. */
export function liveByteLength(pool: Pool): number {
  let bytes = 0;
  for (const column of columnsOf(pool)) {
    bytes += (column.byteLength / pool.capacity) * pool.count;
  }
  return bytes;
}

/** `rows` written back into `pool`, which keeps the pool object every draw holds. */
export function writeRows(pool: Pool, rows: PoolRows): void {
  const columns = columnsOf(pool);
  for (let at = 0; at < columns.length; at += 1) columns[at].set(rows.columns[at]);
  pool.count = rows.count;
  pool.born = rows.born;
}

/** Where the particle at `index`'s numbers for `layer` begin. */
export function uvAt(index: number, layer: number): number {
  return (index * UV_LAYERS + layer) * UV_SLOTS;
}

/**
 * A particle appended at the end of the live range, or null once the pool is full.
 *
 * Birth scale and birth colour start at one because both are a factor of the appearance
 * pass rather than a term of it, so a particle whose emitter keys neither still draws.
 */
export function spawn(
  pool: Pool,
  emitter: number,
  birthTime: number,
  lifetime: number,
  roll: number,
): number | null {
  if (pool.count >= pool.capacity) return null;

  const at = pool.count;
  pool.count += 1;

  pool.emitter[at] = emitter;
  pool.serial[at] = pool.born;
  pool.born += 1;
  pool.birthTime[at] = birthTime;
  pool.lifetime[at] = lifetime;
  pool.roll[at] = roll;
  pool.lingerFrom[at] = NOT_LINGERING;
  pool.tiling.fill(0, at * 2, at * 2 + 2);
  pool.odometer[at] = 0;
  pool.position.fill(0, at * 3, at * 3 + 3);
  pool.rotation.fill(0, at * 3, at * 3 + 3);
  pool.angularVelocity.fill(0, at * 3, at * 3 + 3);
  pool.angularAcceleration.fill(0, at * 3, at * 3 + 3);
  pool.birthDrag.fill(0, at * 3, at * 3 + 3);
  pool.dragTerminal.fill(0, at * 3, at * 3 + 3);
  pool.dragOffset.fill(0, at * 3, at * 3 + 3);
  pool.orbital.fill(0, at * 3, at * 3 + 3);
  pool.velocity.fill(0, at * 3, at * 3 + 3);
  pool.travel.fill(0, at * 3, at * 3 + 3);
  pool.birthScale.fill(1, at * 3, at * 3 + 3);
  pool.frame.set(IDENTITY_FRAME, at * FRAME_SLOTS);
  pool.birthColor.fill(1, at * 4, at * 4 + 4);
  pool.uv.fill(0, uvAt(at, 0), uvAt(at, 0) + UV_LAYERS * UV_SLOTS);

  return at;
}

/**
 * Drops the particle at `index`, moving the last live one into the slot it frees.
 *
 * The swap is what keeps the live range contiguous, and it puts a particle the caller
 * has not seen yet at an index the caller has already passed, so a sweep that retires
 * walks the pool backwards.
 */
export function retire(pool: Pool, index: number): void {
  const last = pool.count - 1;
  if (index < 0 || index > last) return;

  if (index !== last) {
    pool.emitter[index] = pool.emitter[last];
    pool.serial[index] = pool.serial[last];
    pool.birthTime[index] = pool.birthTime[last];
    pool.lifetime[index] = pool.lifetime[last];
    pool.roll[index] = pool.roll[last];
    pool.lingerFrom[index] = pool.lingerFrom[last];
    pool.odometer[index] = pool.odometer[last];
    pool.tiling.copyWithin(index * 2, last * 2, last * 2 + 2);
    pool.position.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.velocity.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.travel.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.birthScale.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.frame.copyWithin(index * FRAME_SLOTS, last * FRAME_SLOTS, (last + 1) * FRAME_SLOTS);
    pool.rotation.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.angularVelocity.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.angularAcceleration.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.birthDrag.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.dragTerminal.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.dragOffset.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.orbital.copyWithin(index * 3, last * 3, last * 3 + 3);
    pool.birthColor.copyWithin(index * 4, last * 4, last * 4 + 4);
    const span = UV_LAYERS * UV_SLOTS;
    pool.uv.copyWithin(uvAt(index, 0), uvAt(last, 0), uvAt(last, 0) + span);
  }

  pool.count = last;
}
