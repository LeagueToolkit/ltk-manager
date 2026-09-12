import { describe, expect, it } from "vitest";

import { ADDRESS_MODE } from "../enums";
import type { PaletteModel, ValueCurve } from "../model";
import { drawsPalette, paletteRow, paletteScrollInto } from "../palette";

function flat(...constant: number[]): ValueCurve {
  return { constant, keys: [], tables: [] };
}

function paletteOf(over: Partial<PaletteModel> = {}): PaletteModel {
  return {
    texture: null,
    count: 1,
    selector: flat(0, 0, 0),
    scrollU: flat(0),
    scrollV: flat(0),
    mix: flat(0.299, 0.587, 0.114, 0),
    addressMode: ADDRESS_MODE.mirror,
    ...over,
  };
}

describe("paletteRow", () => {
  it("centres v on the row the selector's first channel names, of the rows counted", () => {
    expect(paletteRow(paletteOf({ count: 4, selector: flat(2, 0, 0) }))).toBeCloseTo(2.5 / 4, 6);
  });

  it("lands a fractional selector between rows rather than flooring it", () => {
    expect(paletteRow(paletteOf({ count: 2, selector: flat(0.5, 0, 0) }))).toBeCloseTo(0.5, 6);
  });

  it("samples a keyed selector at zero", () => {
    const selector: ValueCurve = {
      constant: [9, 0, 0],
      keys: [
        { time: 0, values: [1, 0, 0] },
        { time: 1, values: [3, 0, 0] },
      ],
      tables: [],
    };
    expect(paletteRow(paletteOf({ count: 4, selector }))).toBeCloseTo(1.5 / 4, 6);
  });
});

describe("paletteScrollInto", () => {
  it("reads both animation curves at the emitter's phase", () => {
    const out = [9, 9];
    const scrollU: ValueCurve = {
      constant: [0],
      keys: [
        { time: 0, values: [0] },
        { time: 1, values: [1] },
      ],
      tables: [],
    };
    paletteScrollInto(paletteOf({ scrollU, scrollV: flat(0.3) }), 0.25, out);

    expect(out[0]).toBeCloseTo(0.25, 6);
    expect(out[1]).toBeCloseTo(0.3, 6);
  });
});

describe("drawsPalette", () => {
  it("draws a palette cut into at least one row and nothing else", () => {
    expect(drawsPalette(paletteOf())).toBe(true);
    expect(drawsPalette(paletteOf({ count: 0 }))).toBe(false);
    expect(drawsPalette(null)).toBe(false);
  });
});
