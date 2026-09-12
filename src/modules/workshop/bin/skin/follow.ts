import type { SceneClock } from "@/modules/viewport";

import type { Driver } from "../vfx/driver";

/** The last jump of the scene's clock a follower replayed to. */
export interface Following {
  generation: number;
}

/**
 * `time` folded into the clip's first pass, and zero where the skin stands in its bind pose.
 *
 * The pose repeats every pass, so a folded clock draws the same frame, and a follower that
 * joins replays one pass at most rather than everything the clock has run.
 */
export function foldedTime(time: number, duration: number): number {
  return duration > 0 ? time % duration : 0;
}

/** A follower that has replayed nothing, so its first frame replays to wherever the clock is. */
export function following(): Following {
  return { generation: -1 };
}

/**
 * Bring `driver` to `clock`'s time: a replay across a jump of the clock, a step otherwise.
 *
 * A seek replays from zero, so a scrub of the clip reaches what playing it reaches, per
 * decision 2.6 of docs/plans/vfx-particle-renderer.md.
 */
export function followClock(
  driver: Pick<Driver, "time" | "advance" | "seek">,
  clock: Pick<SceneClock, "time" | "generation">,
  followed: Following,
): void {
  if (followed.generation !== clock.generation) {
    followed.generation = clock.generation;
    driver.seek(clock.time);
    return;
  }
  driver.advance(clock.time - driver.time);
}
