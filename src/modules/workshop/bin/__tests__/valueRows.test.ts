import { describe, expect, it } from "vitest";

import type { BinRow, BinRows, BinValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  channels,
  colorHex,
  constantRequests,
  dynamicsRequests,
  gradientCss,
  markText,
  stopRequests,
  valueFamily,
  valueMarks,
} from "../valueRows";

const ENTRY = "0x2a1f3c7d";

/** The emitter's `birthColor`, whose wire path is the field's own hash. */
const COLOR_PATH = "0aaaaaaa";
const FLOAT_PATH = "0bbbbbbb";
const DYNAMICS_PATH = `${COLOR_PATH}.bc037de7`;

function row(path: string, value: BinValue, name = path): BinRow {
  return {
    entry: ENTRY,
    path,
    label: path,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

function page(rows: BinRow[]): BinRows {
  return { rows, total: rows.length };
}

function struct(className: string, len: number): BinValue {
  return { type: "struct", classHash: nameHash(className), class: className, len };
}

function vec4(r: number, g: number, b: number, a: number): BinValue {
  return { type: "vector", values: [r, g, b, a] };
}

const colorRow = row(COLOR_PATH, struct("ValueColor", 2), "birthColor");
const floatRow = row(FLOAT_PATH, struct("ValueFloat", 2), "rate");

/** The first level's answer for the colour row: its constant, and a curve. */
const CONSTANTS = new Map<string, BinRows>([
  [
    `${ENTRY}:${COLOR_PATH}`,
    page([
      row(`${COLOR_PATH}.b4b427aa`, vec4(1, 0.5, 0, 1)),
      row(DYNAMICS_PATH, struct("VfxAnimatedColorVariableData", 3)),
    ]),
  ],
  [
    `${ENTRY}:${FLOAT_PATH}`,
    page([
      row(`${FLOAT_PATH}.b4b427aa`, { type: "float", value: 2.5 }),
      row(`${FLOAT_PATH}.bc037de7`, { type: "null" }),
    ]),
  ],
]);

const DYNAMICS = new Map<string, BinRows>([
  [
    `${ENTRY}:${DYNAMICS_PATH}`,
    page([
      row(`${DYNAMICS_PATH}.5d68eeb5`, { type: "container", len: 2, itemKind: "f32" }),
      row(`${DYNAMICS_PATH}.34474c3b`, { type: "container", len: 2, itemKind: "vec4" }),
    ]),
  ],
]);

const STOPS = new Map<string, BinRows>([
  [
    `${ENTRY}:${DYNAMICS_PATH}.5d68eeb5`,
    page([
      row(`${DYNAMICS_PATH}.5d68eeb5[0]`, { type: "float", value: 0 }),
      row(`${DYNAMICS_PATH}.5d68eeb5[1]`, { type: "float", value: 2 }),
    ]),
  ],
  [
    `${ENTRY}:${DYNAMICS_PATH}.34474c3b`,
    page([
      row(`${DYNAMICS_PATH}.34474c3b[0]`, vec4(1, 0, 0, 1)),
      row(`${DYNAMICS_PATH}.34474c3b[1]`, vec4(0, 0, 1, 0)),
    ]),
  ],
]);

describe("valueFamily", () => {
  it("names the four classes whose row draws its constant", () => {
    expect(valueFamily(struct("ValueColor", 2))).toBe("color");
    expect(valueFamily(struct("ValueFloat", 2))).toBe("scalar");
    expect(valueFamily(struct("ValueVector2", 2))).toBe("vector");
    expect(valueFamily(struct("ValueVector3", 2))).toBe("vector");
  });

  it("names no other struct and no leaf", () => {
    expect(valueFamily(struct("VfxEmitterDefinitionData", 139))).toBeNull();
    expect(valueFamily({ type: "float", value: 1 })).toBeNull();
  });
});

describe("the three levels", () => {
  it("asks for every family row's own children first", () => {
    expect(constantRequests([colorRow, floatRow, row("0c", { type: "float", value: 1 })])).toEqual([
      { key: `${ENTRY}:${COLOR_PATH}`, rows: 2 },
      { key: `${ENTRY}:${FLOAT_PATH}`, rows: 2 },
    ]);
  });

  it("asks for the curve of a colour that has one, and for nothing else", () => {
    expect(dynamicsRequests([colorRow, floatRow], CONSTANTS)).toEqual([
      { key: `${ENTRY}:${DYNAMICS_PATH}`, rows: 3 },
    ]);
  });

  it("asks for nothing before the level above answers", () => {
    expect(dynamicsRequests([colorRow], new Map())).toEqual([]);
    expect(stopRequests(new Map())).toEqual([]);
  });

  it("asks for the curve's two lists last", () => {
    expect(stopRequests(DYNAMICS)).toEqual([
      { key: `${ENTRY}:${DYNAMICS_PATH}.5d68eeb5`, rows: 2 },
      { key: `${ENTRY}:${DYNAMICS_PATH}.34474c3b`, rows: 2 },
    ]);
  });
});

describe("valueMarks", () => {
  it("carries a colour's constant and its stops, paired by index", () => {
    const mark = valueMarks([colorRow], CONSTANTS, DYNAMICS, STOPS).get(`${ENTRY}:${COLOR_PATH}`);

    expect(mark?.family).toBe("color");
    expect(channels(mark?.constant ?? undefined)).toEqual([1, 0.5, 0, 1]);
    expect(mark?.stops).toEqual([
      { time: 0, rgba: [1, 0, 0, 1] },
      { time: 2, rgba: [0, 0, 1, 0] },
    ]);
    expect(mark?.curve).toBe(true);
  });

  it("carries a scalar's constant and no stops", () => {
    const mark = valueMarks([floatRow], CONSTANTS, DYNAMICS, STOPS).get(`${ENTRY}:${FLOAT_PATH}`);

    expect(mark?.family).toBe("scalar");
    expect(mark?.constant).toEqual({ type: "float", value: 2.5 });
    expect(mark?.stops).toEqual([]);
    expect(mark?.curve).toBe(false);
  });

  it("carries a null constant while nothing has answered", () => {
    const mark = valueMarks([colorRow], new Map(), new Map(), new Map());

    expect(mark.get(`${ENTRY}:${COLOR_PATH}`)).toEqual({
      family: "color",
      constant: null,
      stops: [],
      curve: false,
    });
  });
});

describe("colorHex and gradientCss", () => {
  it("writes a colour as the bytes Copy value takes, clamped", () => {
    expect(colorHex([1, 0.5, 0, 1])).toBe("#FF8000FF");
    expect(colorHex([2, -1, 0, 1])).toBe("#FF0000FF");
  });

  it("places each stop at its share of the curve's span", () => {
    expect(
      gradientCss([
        { time: 1, rgba: [1, 0, 0, 1] },
        { time: 2, rgba: [0, 1, 0, 1] },
        { time: 5, rgba: [0, 0, 1, 1] },
      ]),
    ).toBe(
      "linear-gradient(to right, rgba(255, 0, 0, 1) 0.00%, rgba(0, 255, 0, 1) 25.00%, rgba(0, 0, 255, 1) 100.00%)",
    );
  });

  it("draws one stop as a band of its own colour, which a gradient of one is not", () => {
    expect(gradientCss([{ time: 0, rgba: [1, 0, 0, 0.5] }])).toBe(
      "linear-gradient(to right, rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5))",
    );
  });

  it("paints nothing for a curve with no stops", () => {
    expect(gradientCss([])).toBe("");
  });
});

describe("markText", () => {
  it("copies a colour as its bytes and a scalar and a vector as they draw", () => {
    expect(
      markText({ family: "color", constant: vec4(1, 0.5, 0, 1), stops: [], curve: false }),
    ).toBe("#FF8000FF");
    expect(
      markText({
        family: "scalar",
        constant: { type: "float", value: 2.5 },
        stops: [],
        curve: false,
      }),
    ).toBe("2.5");
    expect(
      markText({
        family: "vector",
        constant: { type: "vector", values: [0, 1.5, 0] },
        stops: [],
        curve: false,
      }),
    ).toBe("0, 1.5, 0");
  });

  it("copies nothing before the read lands", () => {
    expect(markText(undefined)).toBeNull();
    expect(markText({ family: "color", constant: null, stops: [], curve: false })).toBeNull();
  });
});
