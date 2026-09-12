import { describe, expect, it } from "vitest";

import { childIndex } from "../children";
import type { ChildSetModel, ValueCurve } from "../model";
import { emptySystem } from "../systemModel";

function constant(...values: number[]): ValueCurve {
  return { constant: values, keys: [], tables: [] };
}

function setOf(count: number, over: Partial<ChildSetModel> = {}): ChildSetModel {
  return {
    children: Array.from({ length: count }, (_, at) => emptySystem(`0x${at}`)),
    bones: [],
    probability: constant(0),
    onDeath: false,
    inheritance: null,
    ...over,
  };
}

/** A draw that counts how often it was asked, so a test can say the stream was left alone. */
function counted(value = 0.5) {
  const draw = () => {
    draw.calls += 1;
    return value;
  };
  draw.calls = 0;
  return draw;
}

describe("childIndex", () => {
  it("takes the one child without reading the probability or the stream", () => {
    const draw = counted();

    expect(childIndex(setOf(1, { probability: constant(7) }), 0, draw)).toBe(0);
    expect(draw.calls).toBe(0);
  });

  it("spawns nothing for a set naming no children", () => {
    expect(childIndex(setOf(0), 0, counted())).toBeNull();
  });

  it("spawns nothing for a set naming bones, which spawns through the bone path instead", () => {
    expect(childIndex(setOf(2, { bones: ["R_Hand", "L_Hand"] }), 0, counted())).toBeNull();
    expect(childIndex(setOf(2, { bones: ["R_Hand"] }), 0, counted())).toBeNull();
  });

  it("reads the probability as an index, wrapped over the children and floored at zero", () => {
    expect(childIndex(setOf(3, { probability: constant(2.5) }), 0, counted())).toBe(2);
    expect(childIndex(setOf(3, { probability: constant(3.5) }), 0, counted())).toBe(0);
    expect(childIndex(setOf(3, { probability: constant(-4) }), 0, counted())).toBe(0);
  });

  it("picks by the draw where the probability carries a table", () => {
    const table: ValueCurve = {
      constant: [1],
      keys: [],
      tables: [
        {
          channel: 0,
          single: 1,
          keys: [
            { time: 0, values: [0] },
            { time: 1, values: [4] },
          ],
        },
      ],
    };
    const draw = counted(0.6);

    expect(childIndex(setOf(4, { probability: table }), 0, draw)).toBe(2);
    expect(draw.calls).toBe(1);
  });

  it("reads the probability at the time it is given, which a death spawn sets to the lifetime", () => {
    const keyed: ValueCurve = {
      constant: [0],
      keys: [
        { time: 0, values: [0] },
        { time: 2, values: [1] },
      ],
      tables: [],
    };

    expect(childIndex(setOf(2, { probability: keyed }), 0, counted())).toBe(0);
    expect(childIndex(setOf(2, { probability: keyed }), 2, counted())).toBe(1);
  });
});
