import { describe, expect, it } from "vitest";

import type { BinRow, BinValue, FieldSchema } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  GROUP_FIELDS,
  GROUP_ORDER,
  groupRows,
  inspectorGroups,
  unauthoredFields,
} from "../emitterGroups";

const ENTRY = "0x1a2b3c4d";
const EMITTER = `${nameHash("complexEmitterDefinitionData").slice(2)}[0]`;

function field(name: string, value: BinValue = { type: "float", value: 1 }): BinRow {
  return {
    entry: ENTRY,
    path: `${EMITTER}.${nameHash(name).slice(2)}`,
    label: name,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

const names = (rows: readonly BinRow[]) => rows.map((row) => row.name);

describe("GROUP_FIELDS", () => {
  it("names no field under two groups", () => {
    const all = Object.values(GROUP_FIELDS).flat();

    expect(new Set(all).size).toBe(all.length);
  });
});

describe("groupRows", () => {
  it("puts a field under the group that owns it", () => {
    const grouped = groupRows([
      field("birthScale0"),
      field("scale0"),
      field("texture", { type: "string", value: "assets/x.dds" }),
      field("blendMode"),
    ]);

    expect(grouped.map((each) => each.group)).toEqual(["birth", "scale", "texture", "render"]);
  });

  it("sends a field no group names to Other", () => {
    const grouped = groupRows([field("0x1234abcd"), field("rate")]);

    expect(grouped.map((each) => each.group)).toEqual(["emission", "other"]);
    expect(names(grouped[1]?.rows ?? [])).toEqual(["0x1234abcd"]);
  });

  it("leaves out the fields the card draws itself", () => {
    const grouped = groupRows([
      field("emitterName", { type: "string", value: "Glow" }),
      field("disabled", { type: "bool", value: true }),
    ]);

    expect(grouped).toEqual([]);
  });

  it("lists the groups in card order, skipping those the emitter has no field for", () => {
    const grouped = groupRows([field("blendMode"), field("Material"), field("rate")]);

    expect(grouped.map((each) => each.group)).toEqual(["emission", "render", "material"]);
    expect(GROUP_ORDER.indexOf("emission")).toBeLessThan(GROUP_ORDER.indexOf("render"));
  });

  it("keeps a group's rows in the order the emitter declared them", () => {
    const grouped = groupRows([field("period"), field("rate"), field("lifetime")]);

    expect(names(grouped[0]?.rows ?? [])).toEqual(["period", "rate", "lifetime"]);
  });
});

function declared(name: string): FieldSchema {
  return {
    hash: nameHash(name),
    name,
    declared: { kind: "f32", key: null, value: null },
    revisions: [],
  };
}

describe("unauthoredFields", () => {
  it("leaves out what the emitter authors and what the card draws", () => {
    const held = unauthoredFields(
      [declared("rate"), declared("scale0"), declared("emitterName")],
      new Set([nameHash("rate")]),
    );

    expect(held.map((each) => each.name)).toEqual(["scale0"]);
  });

  it("names a field the database names none by its own hash", () => {
    const held = unauthoredFields([{ ...declared("rate"), name: null }], new Set());

    expect(held[0]?.name).toBe(nameHash("rate"));
  });
});

describe("inspectorGroups", () => {
  it("appends a default to the group its field falls in", () => {
    const groups = inspectorGroups(
      groupRows([field("rate")]),
      unauthoredFields([declared("period")], new Set()),
    );

    expect(groups).toHaveLength(1);
    expect(names(groups[0]?.rows ?? [])).toEqual(["rate"]);
    expect(groups[0]?.defaults.map((each) => each.name)).toEqual(["period"]);
  });

  it("opens a group the emitter sets no field of, in card order", () => {
    const groups = inspectorGroups(
      groupRows([field("blendMode")]),
      unauthoredFields([declared("scale0"), declared("0x1234abcd")], new Set()),
    );

    expect(groups.map((each) => each.group)).toEqual(["scale", "render", "other"]);
  });
});
