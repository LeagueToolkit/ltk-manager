import { describe, expect, it } from "vitest";

import { plotOf, roundDomain, ticksWithin, timeTicks } from "../curvePlot";

describe("the axis ticks", () => {
  it("cuts a span at round steps inside it", () => {
    expect(ticksWithin(-68.2, 68.2)).toEqual([-60, -40, -20, 0, 20, 40, 60]);
    expect(ticksWithin(0, 1)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("widens a lane's range out to the round ticks either side", () => {
    expect(roundDomain(6.75, 27)).toEqual({ low: 5, high: 30, ticks: [5, 10, 15, 20, 25, 30] });
    expect(roundDomain(-10, 10).ticks).toContain(0);
  });

  it("gives a range of one value a step off its own size", () => {
    expect(roundDomain(5, 5)).toEqual({ low: 5, high: 6, ticks: [5, 6] });
  });

  it("ticks a life at its quarters, and a long window at round steps", () => {
    expect(timeTicks(0, 1)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(timeTicks(0, 6)).toEqual([0, 2, 4, 6]);
  });
});

const BOX = { width: 100, height: 50, margin: 0.1 } as const;

function plot(keys: { time: number; values: number[] }[]) {
  return plotOf(keys, BOX);
}

describe("plotOf", () => {
  it("widens the time axis past the particle's life to hold every key", () => {
    const drawn = plot([
      { time: 2, values: [0] },
      { time: 4, values: [10] },
      { time: 6, values: [5] },
    ]);

    expect(drawn?.first).toBe(0);
    expect(drawn?.last).toBe(6);
    expect(drawn?.at.map((x) => Math.round(x))).toEqual([33, 67, 100]);
  });

  it("holds the time axis at the particle's own life where every key falls inside it", () => {
    const drawn = plot([
      { time: 0.2, values: [0] },
      { time: 0.8, values: [10] },
    ]);

    expect(drawn?.first).toBe(0);
    expect(drawn?.last).toBe(1);
    expect(drawn?.at).toEqual([20, 80]);
  });

  it("keeps a margin over and under, so no key lands on the edge", () => {
    const drawn = plot([
      { time: 0, values: [0] },
      { time: 1, values: [10] },
    ]);

    expect(drawn?.low).toBeLessThan(0);
    expect(drawn?.high).toBeGreaterThan(10);
    expect(drawn?.points[0]?.[0]?.y).toBeLessThan(BOX.height);
    expect(drawn?.points[0]?.[1]?.y).toBeGreaterThan(0);
  });

  it("fills the box where the host asks for no margin, as a sparkline does", () => {
    const drawn = plotOf(
      [
        { time: 0, values: [0] },
        { time: 1, values: [10] },
      ],
      { width: 100, height: 50, margin: 0 },
    );

    expect(drawn?.points[0]?.map((point) => point.y)).toEqual([50, 0]);
  });

  it("draws a line per channel, with one axis over them all", () => {
    const drawn = plot([
      { time: 0, values: [0, 10, 5] },
      { time: 1, values: [10, 0, 5] },
    ]);

    expect(drawn?.lines).toHaveLength(3);
    expect(drawn?.points).toHaveLength(3);
    expect(drawn?.low).toBeLessThan(0);
    expect(drawn?.high).toBeGreaterThan(10);
  });

  it("draws a curve of one key flat across the box, not as a mark in its corner", () => {
    const drawn = plot([{ time: 0, values: [90, -90] }]);

    expect(drawn?.at).toEqual([0]);
    expect(drawn?.lines[0]).toBe(
      `0.00,${drawn?.points[0]?.[0]?.y.toFixed(2)} 100.00,${drawn?.points[0]?.[0]?.y.toFixed(2)}`,
    );
    expect(drawn?.lines).toHaveLength(2);
  });

  it("gives a curve that never moves the middle, rather than dividing by nothing", () => {
    const drawn = plot([
      { time: 0, values: [5] },
      { time: 1, values: [5] },
    ]);

    expect(drawn?.points[0]?.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(drawn?.points[0]?.[0]?.y).toBeCloseTo(BOX.height / 2);
  });

  it("stacks keys that share one time at the time they share", () => {
    const drawn = plot([
      { time: 1, values: [0] },
      { time: 1, values: [1] },
    ]);

    expect(drawn?.at).toEqual([100, 100]);
  });

  it("draws nothing with no keys, and nothing in a box of no size", () => {
    expect(plot([])).toBeNull();
    expect(plotOf([{ time: 0, values: [1] }], { ...BOX, width: 0 })).toBeNull();
  });
});
