import { describe, expect, it } from "vitest";

import { colorLookupInto } from "../colorLookup";
import { COLOR_LOOKUP, type ColorLookup } from "../enums";
import type { EmitterModel } from "../model";
import { createPool, spawn } from "../pool";

function emitterOf(
  over: Partial<Pick<EmitterModel, "lookupX" | "lookupY" | "lookupOffsets" | "lookupScales">> = {},
): EmitterModel {
  return {
    lookupX: COLOR_LOOKUP.lifetime,
    lookupY: COLOR_LOOKUP.constant,
    lookupOffsets: [0, 0],
    lookupScales: [1, 1],
    ...over,
  } as EmitterModel;
}

/** One particle at index zero, rolled 0.75, moving at three units a second. */
function onePool(travel: number[] = [0, 3, 0]) {
  const pool = createPool(2);
  spawn(pool, 0, 0, 1, 0.75);
  pool.travel.set(travel, 0);
  return pool;
}

function lookup(emitter: EmitterModel, age01 = 0.5, travel?: number[]): number[] {
  const out = new Float32Array(4).fill(9);
  colorLookupInto(emitter, onePool(travel), 0, age01, out, 2);
  return Array.from(out);
}

describe("colorLookupInto", () => {
  it("reads the age along u and holds v at the scale under the default lookups", () => {
    expect(lookup(emitterOf(), 0.25)).toEqual([9, 9, 0.25, 1]);
  });

  it("reads the roll and the speed where the lookups ask", () => {
    const held = lookup(
      emitterOf({ lookupX: COLOR_LOOKUP.birthRandom, lookupY: COLOR_LOOKUP.velocity }),
    );

    expect(held[2]).toBeCloseTo(0.75, 6);
    expect(held[3]).toBeCloseTo(3, 6);
  });

  it("takes the speed off the travel, which already carries the emitter's own drift", () => {
    const held = lookup(emitterOf({ lookupY: COLOR_LOOKUP.velocity }), 0.5, [4, 3, 0]);

    expect(held[3]).toBeCloseTo(5, 6);
  });

  it("scales and offsets a driven axis", () => {
    const held = lookup(emitterOf({ lookupOffsets: [0.1, 0.2], lookupScales: [2, 1] }), 0.5);

    expect(held[2]).toBeCloseTo(1.1, 6);
  });

  it("reads a constant axis as its scale alone, the offset unread", () => {
    const constant: ColorLookup = COLOR_LOOKUP.constant;
    const held = lookup(
      emitterOf({
        lookupX: constant,
        lookupY: constant,
        lookupOffsets: [0.1, 0.2],
        lookupScales: [0.5, 0.25],
      }),
    );

    expect(held).toEqual([9, 9, 0.5, 0.25]);
  });
});
