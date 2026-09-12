import { describe, expect, it } from "vitest";

import { createSceneClock } from "@/modules/viewport";

import { foldedTime, followClock, following } from "../follow";

/** A driver that records what it was asked to do, and moves its clock as a real one does. */
function recorder() {
  const calls: string[] = [];
  let time = 0;
  return {
    calls,
    get time() {
      return time;
    },
    advance(seconds: number) {
      calls.push(`advance ${seconds}`);
      time += seconds;
    },
    seek(to: number) {
      calls.push(`seek ${to}`);
      time = to;
    },
  };
}

describe("foldedTime", () => {
  it("folds a clock that ran many passes into the first one", () => {
    expect(foldedTime(7.5, 2)).toBe(1.5);
    expect(foldedTime(1.25, 2)).toBe(1.25);
  });

  it("stands the bind pose at zero, which has no pass to fold into", () => {
    expect(foldedTime(312.4, 0)).toBe(0);
  });
});

describe("followClock", () => {
  it("replays to wherever the clock stands on its first frame", () => {
    const clock = createSceneClock();
    clock.advance(1.5);
    const driver = recorder();

    followClock(driver, clock, following());

    expect(driver.calls).toEqual(["seek 1.5"]);
  });

  it("steps by what the clock spent since, once it has caught up", () => {
    const clock = createSceneClock();
    const driver = recorder();
    const followed = following();
    followClock(driver, clock, followed);

    clock.advance(0.25);
    followClock(driver, clock, followed);

    expect(driver.calls).toEqual(["seek 0", "advance 0.25"]);
  });

  it("replays across a seek of the clock rather than stepping over it", () => {
    const clock = createSceneClock();
    const driver = recorder();
    const followed = following();
    followClock(driver, clock, followed);
    clock.advance(0.5);
    followClock(driver, clock, followed);

    clock.seek(2);
    followClock(driver, clock, followed);

    expect(driver.calls).toEqual(["seek 0", "advance 0.5", "seek 2"]);
    expect(driver.time).toBe(2);
  });

  it("holds still while the clock is paused", () => {
    const clock = createSceneClock();
    const driver = recorder();
    const followed = following();
    followClock(driver, clock, followed);

    followClock(driver, clock, followed);

    expect(driver.calls).toEqual(["seek 0", "advance 0"]);
  });
});
