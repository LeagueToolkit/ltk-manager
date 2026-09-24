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
    const mixed = fmix32(seed | 0);
    this.#state = mixed === 0 ? NONZERO : mixed;
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

/**
 * MurmurHash3's 32-bit finaliser, which spreads neighbouring seeds across the whole state.
 *
 * A xorshift's first draws follow its seed's high bits, so seeds 1337 and 1338 would open
 * on nearly the same value without it.
 */
function fmix32(value: number): number {
  let mixed = value;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x85ebca6b);
  mixed ^= mixed >>> 13;
  mixed = Math.imul(mixed, 0xc2b2ae35);
  mixed ^= mixed >>> 16;
  return mixed | 0;
}
