import { describe, expect, it } from "vitest";

import { plotOf } from "../curvePlot";

const BOX = { width: 100, height: 50, margin: 0.1 } as const;

function plot(keys: { time: number; values: number[] }[]) {
  return plotOf(keys, BOX);
}

describe("plotOf", () => {
  it("fits the time axis to the curve's own first and last key", () => {
    const drawn = plot([
      { time: 2, values: [0] },
      { time: 4, values: [10] },
      { time: 6, values: [5] },
    ]);

    expect(drawn?.first).toBe(2);
    expect(drawn?.last).toBe(6);
    expect(drawn?.at).toEqual([0, 50, 100]);
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

  it("spaces keys evenly where every one of them lands at the same time", () => {
    const drawn = plot([
      { time: 1, values: [0] },
      { time: 1, values: [1] },
    ]);

    expect(drawn?.at).toEqual([0, 100]);
  });

  it("draws nothing with no keys, and nothing in a box of no size", () => {
    expect(plot([])).toBeNull();
    expect(plotOf([{ time: 0, values: [1] }], { ...BOX, width: 0 })).toBeNull();
  });
});
