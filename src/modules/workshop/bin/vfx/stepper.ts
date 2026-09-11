/** One slice of simulation time, as the integrator runs one. */
export interface Step {
  /** Seconds the step advances the simulation by. */
  readonly dt: number;
  /** The time the step ends at, which is what a particle's age is measured against. */
  readonly now: number;
}

/** How a frame's elapsed time becomes simulation steps. */
export interface Stepper {
  /** The steps `frameTime` seconds buys, in the order they run. */
  advance(frameTime: number): Step[];
  /** Puts the clock at `now` and drops whatever time is banked. */
  reset(now?: number): void;
  /** The time the last step ended at. */
  readonly now: number;
}

/**
 * How many steps one `advance` runs at the authored period before it coarsens.
 *
 * Eight is a quarter second of banked time at the 30 Hz the manager simulates at, which
 * is as far ahead as one frame should ever catch up. A larger backlog halves the count
 * and doubles `dt` until it fits, which spends a tab left in the background rather than
 * dropping it.
 */
export const MAX_STEPS = 8;

/** A stepper that runs one step per frame, however long the frame was. */
export function variableStepper(now = 0): Stepper {
  let clock = now;

  return {
    get now() {
      return clock;
    },
    advance(frameTime) {
      if (frameTime <= 0) return [];
      clock += frameTime;
      return [{ dt: frameTime, now: clock }];
    },
    reset(to = 0) {
      clock = to;
    },
  };
}

/** A stepper that banks frame time and spends it in whole steps of `1 / rate`. */
export function fixedRateStepper(rate: number, now = 0): Stepper {
  let clock = now;
  let banked = 0;

  return {
    get now() {
      return clock;
    },
    advance(frameTime) {
      if (frameTime > 0) banked += frameTime;

      let count = Math.floor(banked * rate);
      if (count <= 0) return [];

      let dt = 1 / rate;
      while (count > MAX_STEPS) {
        count = Math.floor(count / 2);
        dt *= 2;
      }
      banked -= count * dt;

      const steps: Step[] = [];
      for (let at = 0; at < count; at += 1) {
        clock += dt;
        steps.push({ dt, now: clock });
      }
      return steps;
    },
    reset(to = 0) {
      clock = to;
      banked = 0;
    },
  };
}
