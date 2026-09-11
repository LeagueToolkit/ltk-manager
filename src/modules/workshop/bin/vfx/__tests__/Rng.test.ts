import { describe, expect, it } from "vitest";

import { Rng } from "../Rng";

function draws(seed: number, count: number): number[] {
  const rng = new Rng(seed);
  return Array.from({ length: count }, () => rng.unitFloat());
}

describe("Rng", () => {
  it("draws the same stream every run from the same seed", () => {
    expect(draws(7, 32)).toEqual(draws(7, 32));
  });

  it("draws every value from zero inclusive to one exclusive", () => {
    for (const drawn of draws(1234, 4096)) {
      expect(drawn).toBeGreaterThanOrEqual(0);
      expect(drawn).toBeLessThan(1);
    }
  });

  it("draws a different stream from a different seed", () => {
    expect(draws(1, 16)).not.toEqual(draws(2, 16));
  });

  it("draws from a seed of zero rather than sticking there", () => {
    const drawn = draws(0, 8);
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it("places a range draw between its bounds", () => {
    const rng = new Rng(99);
    for (let n = 0; n < 256; n += 1) {
      const drawn = rng.range(-3, 5);
      expect(drawn).toBeGreaterThanOrEqual(-3);
      expect(drawn).toBeLessThan(5);
    }
  });

  it("hands a clone the stream from where the original stands", () => {
    const rng = new Rng(42);
    rng.unitFloat();
    rng.unitFloat();

    const copy = rng.clone();
    expect(Array.from({ length: 8 }, () => copy.unitFloat())).toEqual(
      Array.from({ length: 8 }, () => rng.unitFloat()),
    );
  });

  it("leaves the original where it stood when a clone draws", () => {
    const rng = new Rng(42);
    const copy = rng.clone();
    copy.unitFloat();

    expect(rng.unitFloat()).toBe(new Rng(42).unitFloat());
  });
});
