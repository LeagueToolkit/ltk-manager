/** The state a zero seed takes, because a xorshift seeded at zero never leaves it. */
const NONZERO = 0x9e3779b9;

/** One over 2^24, the mantissa a double holds exactly, which keeps a draw under one. */
const UNIT = 1 / 0x1000000;

/**
 * A seeded xorshift, in the shape of the engine's `Rand_UnitFloat`.
 *
 * The engine's own generator is a xorshift64 and JavaScript has no u64, so this is
 * Marsaglia's 32-bit variant instead. It answers the same `[0, 1)` from the same seed on
 * every run, which is what a scrub and a snapshot rest on, and it is not the engine's
 * stream. Matching that stream is not verifiable from outside the game.
 */
export class Rng {
  #state: number;

  constructor(seed: number) {
    this.#state = (seed | 0) === 0 ? NONZERO : seed | 0;
  }

  /** The next draw, from zero inclusive to one exclusive. */
  unitFloat(): number {
    let state = this.#state;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.#state = state | 0;
    return (state >>> 8) * UNIT;
  }

  /** The next draw, placed between `lo` inclusive and `hi` exclusive. */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.unitFloat();
  }

  /** A second generator standing where this one stands, so a rewind replays the stream. */
  clone(): Rng {
    const copy = new Rng(0);
    copy.#state = this.#state;
    return copy;
  }
}
