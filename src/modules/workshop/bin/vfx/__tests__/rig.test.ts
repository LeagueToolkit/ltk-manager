import { describe, expect, it } from "vitest";

import { FORWARD } from "@/modules/viewport";

import {
  type Anchor,
  facingAt,
  flightPath,
  landed,
  type Motion,
  originAt,
  phaseAt,
  RIG_PRESETS,
  runLength,
  STAND_HEIGHT,
  targetAt,
} from "../rig";

/** A path a hundred units long at one unit a second, so a second is one percent of it. */
const SLOW: Motion = { kind: "path", from: [0, 0, 0], to: [100, 0, 0], speed: 1 };

/** An anchor walking ten units a second along `x`, turned a quarter about up. */
const WALKER: Anchor = {
  originAt: (time) => [time * 10, 5, 0],
  basisInto: (_time, out) => {
    out.set([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    return out;
  },
};

const BONE: Motion = { kind: "bone", anchor: WALKER, target: null };

function rounded(point: readonly number[]): number[] {
  return point.map((value) => Math.round(value * 1e6) / 1e6 + 0);
}

describe("facingAt", () => {
  it("faces a still rig forward", () => {
    expect(facingAt({ kind: "still" }, 3)).toEqual(FORWARD);
  });

  it("faces a path where it is going, laid flat and unit long", () => {
    const climb: Motion = { kind: "path", from: [0, 0, 0], to: [30, 50, 40], speed: 1 };
    expect(rounded(facingAt(climb, 0))).toEqual([0.6, 0, 0.8]);
    expect(rounded(facingAt(SLOW, 99))).toEqual([1, 0, 0]);
  });

  it("faces forward on a path that only climbs", () => {
    expect(facingAt({ kind: "path", from: [0, 0, 0], to: [0, 10, 0], speed: 1 }, 0)).toEqual(
      FORWARD,
    );
  });

  it("faces an orbit along its own tangent", () => {
    const orbit: Motion = { kind: "orbit", radius: 10, period: 4 };
    expect(rounded(facingAt(orbit, 0))).toEqual([0, 0, 1]);
    expect(rounded(facingAt(orbit, 1))).toEqual([-1, 0, 0]);
  });

  it("faces a bone along its joint's own +Z, laid flat", () => {
    expect(rounded(facingAt(BONE, 0))).toEqual([1, 0, 0]);
  });
});

describe("a bone", () => {
  it("stands where its anchor does at the run's time, lifted by the rig's height", () => {
    expect(originAt(BONE, 2)).toEqual([20, 5, 0]);
    expect(originAt(BONE, 2, 3)).toEqual([20, 8, 0]);
  });

  it("aims at its target anchor", () => {
    const target: Anchor = { ...WALKER, originAt: () => [0, 0, 50] };

    expect(targetAt({ ...BONE, target }, 1)).toEqual([0, 0, 50]);
  });

  it("aims a fixed reach ahead of its anchor without a target", () => {
    const [x, y, z] = targetAt(BONE, 1);

    expect(x).toBeGreaterThan(10);
    expect([y, z]).toEqual([5, 0]);
  });

  it("runs for the system's own span, as a still rig does", () => {
    expect(runLength(BONE, 4.5)).toBe(4.5);
    expect(landed(BONE, 1000)).toBe(false);
  });
});

describe("targetAt", () => {
  it("aims a path where it lands, whatever the time", () => {
    expect(targetAt(SLOW, 0)).toEqual([100, 0, 0]);
    expect(targetAt(SLOW, 50)).toEqual([100, 0, 0]);
  });

  it("aims an orbit at what it circles", () => {
    expect(targetAt({ kind: "orbit", radius: 10, period: 1 }, 0.3)).toEqual([0, 0, 0]);
  });

  it("aims a still rig a fixed reach ahead, so a beam has a length", () => {
    const [x, y, z] = targetAt({ kind: "still" }, 0);

    expect(x).toBeGreaterThan(0);
    expect([y, z]).toEqual([0, 0]);
  });
});

describe("originAt", () => {
  it("leaves a still rig at the world origin", () => {
    expect(originAt({ kind: "still" }, 0)).toEqual([0, 0, 0]);
    expect(originAt({ kind: "still" }, 99)).toEqual([0, 0, 0]);
  });

  it("walks a path at its own speed", () => {
    expect(originAt(SLOW, 0)).toEqual([0, 0, 0]);
    expect(originAt(SLOW, 25)).toEqual([25, 0, 0]);
    expect(originAt(SLOW, 100)).toEqual([100, 0, 0]);
  });

  it("holds a path at its end rather than overshooting it", () => {
    expect(originAt(SLOW, 500)).toEqual([100, 0, 0]);
  });

  it("holds a path at its start before the run began", () => {
    expect(originAt(SLOW, -10)).toEqual([0, 0, 0]);
  });

  it("lands a path with no speed at its end, so a still one is not a stuck one", () => {
    expect(originAt({ ...SLOW, speed: 0 }, 0)).toEqual([100, 0, 0]);
  });

  it("circles an orbit in the ground plane, once per period", () => {
    const orbit: Motion = { kind: "orbit", radius: 10, period: 4 };

    expect(originAt(orbit, 0)).toEqual([10, 0, 0]);

    const quarter = originAt(orbit, 1);
    expect(quarter[0]).toBeCloseTo(0, 10);
    expect(quarter[1]).toBe(0);
    expect(quarter[2]).toBeCloseTo(10, 10);

    const whole = originAt(orbit, 4);
    expect(whole[0]).toBeCloseTo(10, 10);
    expect(whole[2]).toBeCloseTo(0, 10);
  });
});

describe("flightPath", () => {
  it("centres the path on the origin, so the whole run is on screen", () => {
    const path = flightPath(200, 400);
    if (path.kind !== "path") throw new Error("a flight is a path");

    expect(path.from[0]).toBe(-100);
    expect(path.to[0]).toBe(100);
    expect(path.speed).toBe(400);
  });

  it("lays the path on the ground plane, which the rig's own height then lifts", () => {
    const path = flightPath(200, 400);
    if (path.kind !== "path") throw new Error("a flight is a path");

    expect(path.from[1]).toBe(0);
    expect(path.to[1]).toBe(0);
    expect(originAt(path, 0, STAND_HEIGHT)[1]).toBe(STAND_HEIGHT);
  });
});

describe("runLength", () => {
  it("ends a path on arrival, plus the linger its particles play out for", () => {
    expect(runLength(SLOW, 30)).toBe(100);
    expect(runLength(SLOW, 30, 2.5)).toBe(102.5);
  });

  it("is the scrub's whole window, one flight however long the system", () => {
    expect(runLength(SLOW, 300)).toBe(100);
    expect(runLength(RIG_PRESETS.still.motion, 6)).toBe(6);
  });

  it("gives a still rig the system's own span", () => {
    expect(runLength({ kind: "still" }, 4.5)).toBe(4.5);
  });

  it("gives an orbit whichever of its period and the span is longer", () => {
    const slow: Motion = { kind: "orbit", radius: 1, period: 9 };

    expect(runLength(slow, 2)).toBe(9);
    expect(runLength(slow, 20)).toBe(20);
  });

  it("falls back to the span for a path that never moves", () => {
    expect(runLength({ ...SLOW, speed: 0 }, 7)).toBe(7);
  });

  it("falls back to the span for a path with nowhere to go, rather than to no run at all", () => {
    const stuck: Motion = { kind: "path", from: [5, 0, 0], to: [5, 0, 0], speed: 100 };

    expect(runLength(stuck, 7)).toBe(7);
  });
});

describe("phaseAt", () => {
  it("counts a run that does not loop straight off the clock", () => {
    expect(phaseAt({ motion: SLOW, life: "once", height: 0 }, 250, 4)).toBe(250);
  });

  it("wraps a looping run on its own length rather than on when it was picked", () => {
    const rig = { motion: SLOW, life: "loop", height: 0 } as const;

    expect(phaseAt(rig, 40, 4)).toBe(40);
    expect(phaseAt(rig, 100, 4)).toBe(0);
    expect(phaseAt(rig, 260, 4)).toBe(60);
  });

  it("wraps a still rig on the system's own span", () => {
    expect(phaseAt(RIG_PRESETS.burst, 7, 3)).toBe(1);
  });

  it("wraps a looping flight past its linger tail", () => {
    const rig = { motion: SLOW, life: "loop", height: 0 } as const;

    expect(phaseAt(rig, 101, 4, 2)).toBe(101);
    expect(phaseAt(rig, 103, 4, 2)).toBe(1);
  });
});

describe("landed", () => {
  it("is where a path has arrived, and never for a motion that flies nowhere", () => {
    expect(landed(SLOW, 99)).toBe(false);
    expect(landed(SLOW, 100)).toBe(true);
    expect(landed({ ...SLOW, speed: 0 }, 1000)).toBe(false);
    expect(landed({ kind: "still" }, 1000)).toBe(false);
  });
});

describe("RIG_PRESETS", () => {
  it("opens on the rig that moves nothing and plays through once", () => {
    expect(RIG_PRESETS.still).toEqual({
      motion: { kind: "still" },
      life: "once",
      height: STAND_HEIGHT,
    });
  });

  it("separates a burst from a still rig by replaying it, not by moving it", () => {
    expect(RIG_PRESETS.burst.motion).toEqual(RIG_PRESETS.still.motion);
    expect(RIG_PRESETS.burst.life).toBe("loop");
  });

  it("flies a missile and replays it on arrival", () => {
    expect(RIG_PRESETS.missile.motion.kind).toBe("path");
    expect(RIG_PRESETS.missile.life).toBe("loop");
  });

  it("circles a trail without ever restarting it", () => {
    expect(RIG_PRESETS.trail.motion.kind).toBe("orbit");
    expect(RIG_PRESETS.trail.life).toBe("once");
  });
});
