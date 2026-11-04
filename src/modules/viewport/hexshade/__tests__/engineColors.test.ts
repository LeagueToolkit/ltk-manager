import { describe, expect, it } from "vitest";

import { engineColors } from "../engineColors";

describe("engineColors", () => {
  it("swaps red and blue of each vertex", () => {
    const attribute = engineColors(new Uint8Array([10, 20, 30, 40, 255, 128, 0, 200]));

    expect([...(attribute.array as Uint8Array)]).toEqual([30, 20, 10, 40, 0, 128, 255, 200]);
  });

  it("returns a normalized attribute of four bytes per vertex", () => {
    const attribute = engineColors(new Uint8Array(8));

    expect(attribute.itemSize).toBe(4);
    expect(attribute.normalized).toBe(true);
  });
});
