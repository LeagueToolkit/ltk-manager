import { describe, expect, it } from "vitest";

import type { BinRow, BinValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import { classLayout, materialLayout, placeRows } from "../classLayouts";

/** A depth-zero property row of the material, whose wire path is the field's hash. */
function field(name: string, value: BinValue = { type: "string", value: "" }): BinRow {
  return {
    entry: "0x2a1f3c7d",
    path: nameHash(name).slice(2),
    label: name,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

const list = (len: number): BinValue => ({ type: "container", len, itemKind: "embed" });

describe("classLayout", () => {
  it("opens a material in its own layout and every other class in none", () => {
    expect(classLayout(nameHash("StaticMaterialDef"))).toBe(materialLayout);
    expect(classLayout(nameHash("SkinCharacterDataProperties"))).toBeUndefined();
  });
});

describe("placeRows", () => {
  const roots = [
    field("name"),
    field("type", { type: "integer", text: "1" }),
    field("samplerValues", list(2)),
    field("paramValues", list(1)),
    field("switches", list(0)),
    field("shaderMacros", { type: "map", len: 3, keyKind: "string", valueKind: "string" }),
    field("techniques", list(1)),
    field("dynamicMaterial", { type: "null" }),
    field("childTechniques", list(0)),
  ];

  it("places every depth-zero row once, and every one the layout does not name in Other", () => {
    const placed = placeRows(roots, materialLayout);

    const drawn = placed.flatMap((section) => section.rows.map((row) => row.name));
    expect([...drawn].sort()).toEqual(roots.map((row) => row.name).sort());

    const other = placed.at(-1);
    expect(other?.other).toBe(true);
    expect(other?.widget).toBe("tree");
    expect(other?.rows.map((row) => row.name)).toEqual(["dynamicMaterial", "childTechniques"]);
  });

  it("draws the sections in the layout's order and names each one", () => {
    const placed = placeRows(roots, materialLayout);

    expect(placed.map((section) => section.title())).toEqual([
      "Identity",
      "Samplers",
      "Params",
      "Switches",
      "Macros",
      "Techniques",
      "Other",
    ]);
  });

  it("keeps a section the object has no field for, so one class has one section order", () => {
    const placed = placeRows([field("name")], materialLayout);

    expect(placed).toHaveLength(materialLayout.sections.length + 1);
    expect(placed[1]?.rows).toEqual([]);
    expect(placed.at(-1)?.rows).toEqual([]);
  });

  it("names a widget only where the layout does, and the tree for Other", () => {
    const placed = placeRows(roots, materialLayout);

    expect(placed.map((section) => section.widget)).toEqual([
      undefined,
      "sampler-table",
      "param-table",
      "switch-list",
      "tree",
      "tree",
      "tree",
    ]);
  });
});
