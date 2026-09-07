import { describe, expect, it } from "vitest";

import type { BinRow, BinValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  classLayout,
  descentOf,
  frameOf,
  levelRequests,
  materialLayout,
  MAX_LEVELS,
  placeRows,
  type SectionWidget,
  skinLayout,
  vfxLayout,
} from "../classLayouts";

const ENTRY = "0x2a1f3c7d";

/** A depth-zero property row of the material, whose wire path is the field's hash. */
function field(name: string, value: BinValue = { type: "string", value: "" }): BinRow {
  return row(nameHash(name).slice(2), name, value);
}

/** One row of the object, addressed by its own wire path. */
function row(path: string, name: string, value: BinValue): BinRow {
  return {
    entry: ENTRY,
    path,
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
const embed = (className: string, len: number): BinValue => ({
  type: "struct",
  classHash: nameHash(className),
  class: className,
  len,
});

describe("classLayout", () => {
  it("opens each registered class in its own layout, and every other class in none", () => {
    expect(classLayout(nameHash("StaticMaterialDef"))).toBe(materialLayout);
    expect(classLayout(nameHash("SkinCharacterDataProperties"))).toBe(skinLayout);
    expect(classLayout(nameHash("VfxSystemDefinitionData"))).toBe(vfxLayout);
    expect(classLayout(nameHash("AnimationGraphData"))).toBeUndefined();
  });

  it("opens the TFT skin in the skin layout, which the schema does not say derives it", () => {
    expect(classLayout(nameHash("TftSkinCharacterDataProperties"))).toBe(skinLayout);
  });
});

describe("frameOf", () => {
  it("gives a layout that names no frame the stack", () => {
    expect(frameOf(materialLayout)).toBe("stack");
    expect(frameOf(skinLayout)).toBe("stack");
  });

  it("gives the particle system the shell it declares", () => {
    expect(frameOf(vfxLayout)).toBe("shell");
  });
});

describe("descentOf", () => {
  const widgets: SectionWidget[] = [
    "sampler-table",
    "param-table",
    "switch-list",
    "tree",
    "fields",
    "icons",
    "mesh",
    "override-table",
    "effect-table",
    "emitters",
  ];

  it("keeps every widget inside the levels the view reads", () => {
    for (const widget of widgets) {
      expect(descentOf(widget).length).toBeLessThanOrEqual(MAX_LEVELS);
    }
    expect(descentOf(undefined)).toEqual([]);
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

describe("placeRows over a skin", () => {
  const roots = [
    field("championSkinName"),
    field("skinMeshProperties", embed("SkinMeshDataProperties", 38)),
    field("idleParticlesEffects", list(2)),
    field("mResourceResolver", { type: "objectLink", hash: "0x11223344", name: null }),
    field("healthBarData", embed("CharacterHealthBarDataRecord", 4)),
  ];

  it("places the mesh row in both the sections that draw a part of it", () => {
    const placed = placeRows(roots, skinLayout);
    const mesh = placed.filter((section) =>
      section.rows.some((row) => row.name === "skinMeshProperties"),
    );

    expect(mesh.map((section) => section.widget)).toEqual(["mesh", "override-table"]);
  });

  it("leaves a field no section names to Other, the mesh included once it is placed", () => {
    const placed = placeRows(roots, skinLayout);

    expect(placed.at(-1)?.rows.map((row) => row.name)).toEqual(["healthBarData"]);
  });

  it("names the fields a section draws under the row it placed", () => {
    const placed = placeRows(roots, skinLayout);
    const animation = placed.find((section) => section.title() === "Animation");

    expect(animation?.under).toEqual(["animationGraphData"]);
  });
});

describe("levelRequests", () => {
  const roots = [
    field("skinMeshProperties", embed("SkinMeshDataProperties", 38)),
    field("idleParticlesEffects", list(2)),
  ];
  const placed = placeRows(roots, skinLayout);
  const meshKey = `${ENTRY}:${nameHash("skinMeshProperties").slice(2)}`;
  const effectsKey = `${ENTRY}:${nameHash("idleParticlesEffects").slice(2)}`;

  it("asks for every placed row of a widget section, and for none of a tree", () => {
    expect(
      levelRequests(placed, new Map(), 0)
        .map((request) => request.key)
        .sort(),
    ).toEqual([effectsKey, meshKey, meshKey].sort());
  });

  it("carries only the field a section named into the level under it", () => {
    const under = row(
      `${nameHash("skinMeshProperties").slice(2)}.${nameHash("materialOverride").slice(2)}`,
      "materialOverride",
      list(1),
    );
    const other = row(
      `${nameHash("skinMeshProperties").slice(2)}.${nameHash("texture").slice(2)}`,
      "texture",
      { type: "string", value: "" },
    );
    const pages = new Map([[meshKey, { rows: [under, other], total: 2 }]]);

    expect(levelRequests(placed, pages, 1).map((request) => request.key)).toEqual([
      `${ENTRY}:${under.path}`,
    ]);
  });

  it("asks for nothing under a row that holds none", () => {
    const empty = row(
      `${nameHash("skinMeshProperties").slice(2)}.${nameHash("materialOverride").slice(2)}`,
      "materialOverride",
      list(0),
    );
    const pages = new Map([[meshKey, { rows: [empty], total: 1 }]]);

    expect(levelRequests(placed, pages, 1)).toEqual([]);
  });
});
