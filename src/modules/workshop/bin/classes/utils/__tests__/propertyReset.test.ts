import { describe, expect, it } from "vitest";

import type { BinRow, FieldSchema } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import { parentPath, propertyReset } from "../propertyReset";

const CONSTANT = nameHash("constantValue");
const DYNAMICS = nameHash("dynamics").slice(2);

function row(over: Partial<BinRow> = {}): BinRow {
  return {
    entry: "0x00000001",
    path: "aaaaaaaa.bbbbbbbb",
    label: "emitter.rate",
    node: "property",
    name: "rate",
    unnamed: false,
    kind: "f32",
    declared: null,
    value: { type: "float", value: 4 },
    ...over,
  };
}

function field(defaultValue: string | null): FieldSchema {
  return {
    hash: "0xbbbbbbbb",
    name: "rate",
    declared: { kind: "f32", key: null, value: null },
    classHash: null,
    defaultValue,
    owner: null,
    revisions: [],
  };
}

describe("propertyReset", () => {
  it("removes the property where the document can drop one", () => {
    expect(propertyReset(row(), field("2"), false, false)).toEqual({ kind: "remove" });
  });

  it("writes the schema default in a declared document", () => {
    expect(propertyReset(row(), field("2"), true, false)).toEqual({
      kind: "leaf",
      leaf: { type: "float", value: 2 },
    });
  });

  it("writes the kind's zero where the schema holds no default", () => {
    expect(propertyReset(row({ kind: "vec3" }), undefined, true, false)).toEqual({
      kind: "leaf",
      leaf: { type: "vector", values: [0, 0, 0] },
    });
    expect(propertyReset(row({ kind: "rgba" }), field(null), true, false)).toEqual({
      kind: "leaf",
      leaf: { type: "color", r: 255, g: 255, b: 255, a: 255 },
    });
  });

  it("resets a value class's constant and drops its curve", () => {
    const value = row({
      kind: "embed",
      value: { type: "struct", classHash: nameHash("ValueVector3"), class: "ValueVector3", len: 2 },
    });

    expect(propertyReset(value, field('{"constantValue":[1,2,3]}'), true, true)).toEqual({
      kind: "value",
      edits: [
        { type: "ensureProperty", path: "", field: CONSTANT },
        { type: "setLeaf", path: CONSTANT.slice(2), value: { type: "vector", values: [1, 2, 3] } },
        { type: "replacePointer", path: DYNAMICS, class: null },
      ],
    });
  });

  it("gives a colour with no schema default opaque white", () => {
    const value = row({
      kind: "embed",
      value: { type: "struct", classHash: nameHash("ValueColor"), class: "ValueColor", len: 1 },
    });
    const reset = propertyReset(value, undefined, true, false);

    expect(reset.kind === "value" && reset.edits[1]).toEqual({
      type: "setLeaf",
      path: CONSTANT.slice(2),
      value: { type: "vector", values: [1, 1, 1, 1] },
    });
  });

  it("empties a present option in a declared document", () => {
    const period = row({ kind: "option", value: { type: "float", value: 2 } });

    expect(propertyReset(period, undefined, true, false)).toEqual({
      kind: "value",
      edits: [{ type: "removeItem", path: "[0]" }],
    });
  });

  it("leaves an empty option unchanged", () => {
    const period = row({
      kind: "option",
      value: { type: "optional", present: false, itemKind: "f32" },
    });

    expect(propertyReset(period, undefined, true, false)).toEqual({ kind: "unchanged" });
  });

  it("removes an option where the document can drop one", () => {
    const period = row({ kind: "option", value: { type: "float", value: 2 } });

    expect(propertyReset(period, undefined, false, false)).toEqual({ kind: "remove" });
  });

  it("refuses a list in a declared document", () => {
    const list = row({ kind: "list", value: { type: "container", len: 2, itemKind: "f32" } });

    expect(propertyReset(list, undefined, true, false)).toEqual({ kind: "refused" });
  });
});

describe("parentPath", () => {
  it("drops the property's own segment", () => {
    expect(parentPath("aaaaaaaa[2].bbbbbbbb")).toBe("aaaaaaaa[2]");
    expect(parentPath("bbbbbbbb")).toBe("");
  });
});
