/** One moment of a run as the set reads it: the seek step it stands at, and its bytes. */
export interface Moment {
  readonly step: number;
  readonly bytes: number;
}

/** One run's checkpoints by quarter-second mark, bounded by the bytes they hold. */
export interface Checkpoints<T extends Moment> {
  /** Mark `at` is in range and holds nothing yet. */
  wants(at: number): boolean;
  /**
   * Keep what `capture` takes at mark `at`, where the mark holds none and a run this
   * heavy has room for it. `bytes` is what the capture would hold, which sets the stride.
   */
  keep(at: number, bytes: number, capture: () => T): void;
  /** The latest checkpoint at or before mark `at` that stands at or before `step`. */
  latest(at: number, step: number): T | null;
  clear(): void;
  /** The bytes of every checkpoint held, summed. */
  readonly bytes: number;
}

/** Marks 1 to `most` within `budget` bytes, per decision 2.46 of docs/plans/vfx-particle-renderer.md. */
export function createCheckpoints<T extends Moment>(most: number, budget: number): Checkpoints<T> {
  const held: (T | undefined)[] = [];
  let bytes = 0;

  /** The stride marks are kept at from `at` on, for the rest of a run this heavy to fit. */
  function strideAt(at: number, size: number): number {
    const remaining = most - at + 1;
    let stride = 1;
    while (Math.ceil(remaining / stride) * size > budget) stride *= 2;
    return stride;
  }

  /** Drop every other held mark, then every other of those, until `need` bytes fit. */
  function thin(need: number): void {
    for (let step = 2; bytes + need > budget; step *= 2) {
      for (let at = 1; at < held.length; at += 1) {
        const mark = held[at];
        if (mark === undefined || at % step === 0) continue;
        bytes -= mark.bytes;
        held[at] = undefined;
      }
    }
  }

  return {
    wants(at) {
      return at >= 1 && at <= most && held[at] === undefined;
    },
    keep(at, size, capture) {
      if (at < 1 || at > most || held[at] !== undefined || size > budget) return;
      if (at % strideAt(at, size) !== 0) return;
      if (bytes + size > budget) thin(size);
      const mark = capture();
      held[at] = mark;
      bytes += mark.bytes;
      if (bytes > budget) thin(0);
    },
    latest(at, step) {
      for (let mark = Math.min(at, most); mark >= 1; mark -= 1) {
        const found = held[mark];
        if (found !== undefined && found.step <= step) return found;
      }
      return null;
    },
    clear() {
      held.length = 0;
      bytes = 0;
    },
    get bytes() {
      return bytes;
    },
  };
}
