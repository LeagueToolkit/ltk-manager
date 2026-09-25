const STEP_SECONDS = 1 / 30;
const STEPS_PER_FRAME = 8;
const FRAME_BUDGET_MS = 2;

interface WarmupOptions {
  /** Particle time sampled before the system counts as empty, in seconds. */
  readonly seconds: number;
  /** Whether a particle is alive, which ends the sample early. */
  readonly hasContent?: () => boolean;
  readonly now?: () => number;
}

/** Particle time sampled in bounded batches up to the first visible burst, independent of frame rate. */
export function createPreviewWarmup(
  advance: (seconds: number) => void,
  { seconds, hasContent = () => false, now = () => performance.now() }: WarmupOptions,
) {
  let remaining = Math.max(1, Math.round(seconds / STEP_SECONDS));
  let found = false;

  return {
    /** The sample ended, by finding a burst or by running out of time. */
    get ready() {
      return remaining === 0;
    },
    /** A particle was alive when the sample stopped. */
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

        if (hasContent()) {
          found = true;
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
