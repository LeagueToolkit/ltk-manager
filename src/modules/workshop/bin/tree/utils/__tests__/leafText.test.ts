import { describe, expect, it } from "vitest";

import {
  boolLeaf,
  colorLeaf,
  floatLeaf,
  hashedLeaf,
  integerLeaf,
  matrixLeaf,
  stringLeaf,
  vectorLeaf,
} from "../leafText";

describe("a typed leaf", () => {
  it("sends a bool and an integer's digits as they are", () => {
    expect(boolLeaf(true)).toEqual({ ok: true, leaf: { type: "bool", value: true } });
    expect(integerLeaf(" 18446744073709551615 ")).toEqual({
      ok: true,
      leaf: { type: "integer", text: "18446744073709551615" },
    });
  });

  it("turns down an integer its kind cannot hold before it round-trips", () => {
    expect(integerLeaf("255", "u8")).toEqual({ ok: true, leaf: { type: "integer", text: "255" } });
    expect(integerLeaf("-9223372036854775808", "i64").ok).toBe(true);
    for (const text of ["256", "-1", "1.5", "abc", ""]) {
      expect(integerLeaf(text, "u8")).toEqual({
        ok: false,
        rejection: { reason: "outOfRange", kind: "u8" },
      });
    }
  });

  it("turns down a float JSON cannot carry", () => {
    expect(floatLeaf("2.5")).toEqual({ ok: true, leaf: { type: "float", value: 2.5 } });
    for (const text of ["", "abc", "Infinity", "NaN"]) {
      expect(floatLeaf(text)).toEqual({ ok: false, rejection: { reason: "notFinite" } });
    }
  });

  it("replaces one component of a vector and keeps the rest", () => {
    expect(vectorLeaf([1, 2, 3], 1, "-4")).toEqual({
      ok: true,
      leaf: { type: "vector", values: [1, -4, 3] },
    });
    expect(vectorLeaf([1, null, 3], 0, "5")).toEqual({
      ok: false,
      rejection: { reason: "notFinite" },
    });
  });

  it("holds a colour channel to a byte", () => {
    const color = { type: "color", r: 10, g: 20, b: 30, a: 255 } as const;
    expect(colorLeaf(color, 2, "200")).toEqual({
      ok: true,
      leaf: { type: "color", r: 10, g: 20, b: 200, a: 255 },
    });
    for (const text of ["256", "-1", "1.5", "x"]) {
      expect(colorLeaf(color, 0, text)).toEqual({
        ok: false,
        rejection: { reason: "outOfRange", kind: "u8" },
      });
    }
  });
});

describe("a typed leaf of a matrix, a string and a hash", () => {
  it("replaces one cell of a matrix", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const typed = matrixLeaf(identity, 3, "7");
    expect(typed.ok && typed.leaf).toEqual({
      type: "matrix",
      values: [1, 0, 0, 7, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
  });

  it("keeps a string's spaces", () => {
    expect(stringLeaf("  two words ")).toEqual({
      ok: true,
      leaf: { type: "string", value: "  two words " },
    });
  });

  it("sends a hash, a link and a file as typed, and nothing typed as the zero hash", () => {
    expect(hashedLeaf("objectLink", " Characters/Aatrox ")).toEqual({
      ok: true,
      leaf: { type: "objectLink", text: "Characters/Aatrox" },
    });
    expect(hashedLeaf("wadChunkLink", "   ")).toEqual({
      ok: true,
      leaf: { type: "wadChunkLink", text: "0000000000000000" },
    });
    expect(hashedLeaf("objectLink", "")).toEqual({
      ok: true,
      leaf: { type: "objectLink", text: "0x00000000" },
    });
  });
});
