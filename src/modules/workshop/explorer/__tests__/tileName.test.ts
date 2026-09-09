import { describe, expect, it } from "vitest";

import { EXPLORER_TILE_SIZES } from "@/stores";

import { fitName, NAME_LINES, nameTypeFor } from "../tileName";

describe("nameTypeFor", () => {
  it("steps up the scale with the tile", () => {
    expect(nameTypeFor(64).className).toBe("text-fine");
    expect(nameTypeFor(128).className).toBe("text-meta");
    expect(nameTypeFor(256).className).toBe("text-row");
  });

  it("never steps down as the tile grows", () => {
    const lines = EXPLORER_TILE_SIZES.map((size) => nameTypeFor(size).line);

    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });

  it("answers every tile size the slider offers", () => {
    for (const size of EXPLORER_TILE_SIZES) {
      expect(nameTypeFor(size).line).toBeGreaterThan(0);
      expect(nameTypeFor(size).char).toBeGreaterThan(0);
    }
  });
});

describe("fitName", () => {
  const small = nameTypeFor(64);
  const large = nameTypeFor(256);

  it("leaves a name the tile has room for alone", () => {
    expect(fitName("base.dds", 128, nameTypeFor(128))).toBe("base.dds");
  });

  it("cuts in the middle, so the end that tells two files apart survives", () => {
    const fitted = fitName(`${"a".repeat(200)}_tx_cm.dds`, 128, nameTypeFor(128));

    expect(fitted).toContain("…");
    expect(fitted.endsWith("_tx_cm.dds")).toBe(true);
  });

  it("gives a wider tile a longer budget", () => {
    const narrow = fitName("y".repeat(400), 64, small);
    const wide = fitName("y".repeat(400), 256, large);

    expect(narrow.length).toBeLessThan(wide.length);
  });

  it("keeps the cut inside the lines the tile reserves", () => {
    const type = nameTypeFor(128);
    const perLine = Math.floor((128 - 12) / type.char);

    expect(fitName("x".repeat(500), 128, type).length).toBeLessThanOrEqual(perLine * NAME_LINES);
  });

  it("holds a floor, so the smallest tile still shows something of the name", () => {
    expect(fitName("z".repeat(80), 16, small).length).toBeGreaterThanOrEqual(6 * NAME_LINES);
  });
});
