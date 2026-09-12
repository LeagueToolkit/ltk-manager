import { describe, expect, it } from "vitest";

import { analyticOffset, analyticTerminal } from "../analyticDrag";

describe("analyticTerminal", () => {
  it("is the birth velocity over the birth drag", () => {
    expect(analyticTerminal(100, 4)).toBe(25);
    expect(analyticTerminal(-2000, 50)).toBe(-40);
  });

  it("is nothing on an axis no birth drag damps", () => {
    expect(analyticTerminal(100, 0)).toBe(0);
    expect(analyticTerminal(100, -1)).toBe(0);
  });
});

describe("analyticOffset", () => {
  it("opens at the whole terminal and decays toward nothing", () => {
    expect(analyticOffset(25, 4, 0)).toBe(25);
    expect(analyticOffset(25, 4, 0.5)).toBeCloseTo(25 * Math.exp(-2), 10);
    expect(analyticOffset(25, 4, 100)).toBeCloseTo(0, 10);
  });

  it("holds where nothing damps it", () => {
    expect(analyticOffset(25, 0, 3)).toBe(25);
  });
});
