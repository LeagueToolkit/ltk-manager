const STEP_SECONDS = 1 / 30;
const STEPS_PER_FRAME = 8;
const FRAME_BUDGET_MS = 2;

/** The most particle time a found burst runs on before the sample ends, in seconds. */
export const SETTLE_SECONDS = 0.4;

/** The life fraction of the oldest drawn particle at which a burst counts as grown. */
export const GROWN_AT = 1 / 3;

const SETTLE_STEPS = Math.round(SETTLE_SECONDS / STEP_SECONDS);

interface WarmupOptions {
  /** Particle time sampled before the system counts as empty, in seconds. */
  readonly seconds: number;
  /** The life fraction of the oldest drawn particle, from 0 to 1, and null while none is alive. */
  readonly oldest?: () => number | null;
  readonly now?: () => number;
}

/**
 * Particle time sampled in bounded batches up to a grown first burst, independent of frame rate.
 *
 * The sample searches for the first drawn particle, then settles: it runs on until the oldest
 * drawn particle is `GROWN_AT` through its life, for `SETTLE_SECONDS` at most, or until every
 * drawn particle has died.
 */
export function createPreviewWarmup(
  advance: (seconds: number) => void,
  { seconds, oldest = () => null, now = () => performance.now() }: WarmupOptions,
) {
  let remaining = Math.max(1, Math.round(seconds / STEP_SECONDS));
  let found = false;

  return {
    /** The sample ended, by settling on a burst or by running out of time. */
    get ready() {
      return remaining === 0;
    },
    /** A drawn particle was alive during the sample. */
    get found() {
      return found;
    },
    run() {
      const start = now();
      let steps = 0;

      while (remaining > 0 && steps < STEPS_PER_FRAME) {
        advance(STEP_SECONDS);
        remaining -= 1;
        steps += 1;

        const age = oldest();
        if (!found && age !== null) {
          found = true;
          remaining = SETTLE_STEPS;
        }

        if (found && (age === null || age >= GROWN_AT)) {
          remaining = 0;
          break;
        }

        if (now() - start >= FRAME_BUDGET_MS) {
          break;
        }
      }
    },
  };
}
