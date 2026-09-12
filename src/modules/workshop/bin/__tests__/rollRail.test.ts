import { describe, expect, it } from "vitest";

import type { BinRow } from "@/lib/tauri";

import { nameHash } from "../binHash";
import { railMark } from "../rollRail";
import type { ProbabilityTable, ValueMark } from "../valueRows";

const EMITTER = "868eb76a[0]";

function row(name: string): BinRow {
  return {
    entry: "0x3c4d5e6f",
    path: `${EMITTER}.${nameHash(name).slice(2)}`,
    label: name,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value: { type: "struct", classHash: nameHash("ValueFloat"), class: "ValueFloat", len: 2 },
    declared: null,
  };
}

function table(channel: number, keys: [number, number][], single = 1): ProbabilityTable {
  return { channel, single, keys: keys.map(([time, value]) => ({ time, values: [value] })) };
}

/** A table that multiplies by 1, which is a channel the draw leaves alone. */
const IDENTITY = (channel: number): ProbabilityTable => table(channel, []);

/** A table drawing evenly between two factors, which is what a uniform range writes. */
const UNIFORM = (channel: number): ProbabilityTable =>
  table(channel, [
    [0, 0.5],
    [1, 1.5],
  ]);

function scalar(tables: ProbabilityTable[]): ValueMark {
  return {
    family: "scalar",
    constant: { type: "float", value: 2 },
    keys: [],
    tables,
    curve: true,
    slots: tables.length,
  };
}

function colour(tables: ProbabilityTable[]): ValueMark {
  return {
    family: "color",
    constant: { type: "vector", values: [1, 0, 0, 1] },
    keys: [],
    tables,
    curve: true,
    slots: tables.length,
  };
}

describe("railMark", () => {
  it("marks a birth field whose table draws more than one value", () => {
    expect(railMark(row("birthVelocity"), scalar([UNIFORM(0)]))).toBe("roll");
  });

  it("marks the lifetime, which the birth roll reaches under another name", () => {
    expect(railMark(row("particleLifetime"), scalar([UNIFORM(0)]))).toBe("roll");
  });

  it("marks a per-frame field as a roll of its own, not a share of the birth roll", () => {
    const tables = [UNIFORM(0), IDENTITY(1), IDENTITY(2), IDENTITY(3)];

    expect(railMark(row("Color"), colour(tables))).toBe("flicker");
  });

  it("leaves a randomized field the roll does not reach to its own chip", () => {
    expect(railMark(row("rate"), scalar([UNIFORM(0)]))).toBeNull();
  });

  it("leaves a birth field whose tables draw one value alone", () => {
    expect(railMark(row("birthVelocity"), scalar([IDENTITY(0)]))).toBeNull();
  });

  it("leaves a field with no tables read alone", () => {
    expect(railMark(row("birthVelocity"), undefined)).toBeNull();
    expect(railMark(row("birthVelocity"), scalar([]))).toBeNull();
  });

  it("keeps a birth field on the rail when the game cannot read its set", () => {
    const broken: ValueMark = {
      family: "vector",
      constant: { type: "vector", values: [1, 2, 3] },
      keys: [],
      tables: [UNIFORM(0)],
      curve: true,
      slots: 3,
    };

    expect(railMark(row("birthScale0"), broken)).toBe("roll");
  });
});
