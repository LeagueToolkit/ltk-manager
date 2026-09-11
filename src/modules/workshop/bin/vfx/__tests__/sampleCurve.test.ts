import { describe, expect, it } from "vitest";

import type { ProbabilityTable } from "../../valueRows";
import type { ValueCurve } from "../model";
import { drawCurve, sampleCurve, sampleCurveInto, tableValue } from "../sampleCurve";

function tableOf(channel: number, ...keys: [number, number][]): ProbabilityTable {
  return { channel, single: 1, keys: keys.map(([time, value]) => ({ time, values: [value] })) };
}

describe("tableValue", () => {
  it("reads a table's single value where it holds no keys", () => {
    expect(tableValue({ channel: 0, single: 0.5, keys: [] }, 0.3)).toBe(0.5);
  });

  it("blends the two keys the draw falls between, flat past both ends", () => {
    const table = tableOf(0, [0, 1], [1, 360]);
    expect(tableValue(table, 0)).toBe(1);
    expect(tableValue(table, 0.5)).toBeCloseTo(180.5, 6);
    expect(tableValue(table, 1)).toBe(360);
    expect(tableValue(tableOf(0, [0.2, 10], [0.6, 30]), 0)).toBe(10);
    expect(tableValue(tableOf(0, [0.2, 10], [0.6, 30]), 0.9)).toBe(30);
  });

  it("answers one key as a fixed value", () => {
    expect(tableValue(tableOf(0, [0, 90]), 0.7)).toBe(90);
  });
});

describe("drawCurve", () => {
  it("multiplies each table's value at the chance into its own channel and leaves the rest", () => {
    const curve: ValueCurve = {
      constant: [1, -400, 5],
      keys: [],
      tables: [tableOf(0, [0, 90]), tableOf(1, [0, 0], [1, 1])],
    };
    const drawn = drawCurve(curve, 0, 0.25);

    expect(drawn[0]).toBe(90);
    expect(drawn[1]).toBeCloseTo(-100, 6);
    expect(drawn[2]).toBe(5);
  });

  it("leaves a curve with no tables as sampled, in a copy", () => {
    const curve: ValueCurve = { constant: [2, 4], keys: [], tables: [] };
    const drawn = drawCurve(curve, 0, 0.5);

    expect(drawn).toEqual([2, 4]);
    expect(drawn).not.toBe(curve.constant);
  });

  it("reads every channel's table at the one chance", () => {
    const curve: ValueCurve = {
      constant: [1, 1, 1],
      keys: [],
      tables: [tableOf(0, [0, 0], [1, 1]), tableOf(1, [0, 0], [1, 2]), tableOf(2, [0, 0], [1, 4])],
    };

    expect(drawCurve(curve, 0, 0.5)).toEqual([0.5, 1, 2]);
  });
});

function keyed(...keys: [number, ...number[]][]): ValueCurve {
  return {
    constant: [-1],
    keys: keys.map(([time, ...values]) => ({ time, values })),
    tables: [],
  };
}

describe("sampleCurve", () => {
  it("answers the constant whole for a value that carries no keys", () => {
    expect(sampleCurve({ constant: [2, 4, 8], keys: [], tables: [] }, 0.5)).toEqual([2, 4, 8]);
  });

  it("answers the one key for a curve keyed once, leaving the constant unread", () => {
    expect(sampleCurve(keyed([0.25, 7]), 0.9)).toEqual([7]);
  });

  it("blends the two keys a time falls between", () => {
    expect(sampleCurve(keyed([0, 0], [1, 10]), 0.5)).toEqual([5]);
    expect(sampleCurve(keyed([0.2, 100], [0.6, 300]), 0.4)[0]).toBeCloseTo(200, 10);
  });

  it("holds the first key flat before it and the last key flat after it", () => {
    const curve = keyed([0.25, 3], [0.75, 9]);
    expect(sampleCurve(curve, 0)).toEqual([3]);
    expect(sampleCurve(curve, 0.25)).toEqual([3]);
    expect(sampleCurve(curve, 0.75)).toEqual([9]);
    expect(sampleCurve(curve, 1)).toEqual([9]);
  });

  it("blends every channel of a vector curve in step", () => {
    const curve = keyed([0, 0, 10, 100, 1000], [1, 2, 30, 500, 3000]);
    expect(sampleCurve(curve, 0.5)).toEqual([1, 20, 300, 2000]);
  });

  it("draws the later of two keys sharing one time", () => {
    expect(sampleCurve(keyed([0, 1], [0.5, 2], [0.5, 8], [1, 9]), 0.5)).toEqual([8]);
  });

  it("reads a time outside the keyed range against the keys rather than clamping it", () => {
    const curve = keyed([0, 0], [1, 10]);
    expect(sampleCurve(curve, -4)).toEqual([0]);
    expect(sampleCurve(curve, 4)).toEqual([10]);
  });
});

describe("sampleCurveInto", () => {
  it("writes a constant into the slot the caller names", () => {
    const out = new Float32Array(8).fill(-1);
    sampleCurveInto({ constant: [1, 2, 3], keys: [], tables: [] }, 0.5, out, 3);

    expect(Array.from(out)).toEqual([-1, -1, -1, 1, 2, 3, -1, -1]);
  });

  it("writes a blended key into the slot the caller names", () => {
    const out = new Float32Array(4).fill(0);
    sampleCurveInto(keyed([0, 0, 0], [1, 4, 8]), 0.25, out, 1);

    expect(Array.from(out)).toEqual([0, 1, 2, 0]);
  });

  it("leaves the channels a narrower curve does not reach", () => {
    const out = Float32Array.from([9, 9, 9, 9]);
    sampleCurveInto({ constant: [1, 2, 3], keys: [], tables: [] }, 0, out, 0);

    expect(Array.from(out)).toEqual([1, 2, 3, 9]);
  });

  it("writes nothing past the end of the caller's array", () => {
    const out = Float32Array.from([0, 0]);
    sampleCurveInto({ constant: [5, 6, 7], keys: [], tables: [] }, 0, out, 1);

    expect(Array.from(out)).toEqual([0, 5]);
  });
});
