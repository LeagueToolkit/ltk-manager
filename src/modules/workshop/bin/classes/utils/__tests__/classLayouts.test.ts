import { describe, expect, it } from "vitest";

import type { BinRow, BinValue } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import {
  animationGraphLayout,
  atlasLayout,
  atlasLoadableLayout,
  classLayout,
  descentOf,
  elementLayout,
  fontLayout,
  frameOf,
  levelRequests,
  materialLayout,
  MAX_LEVELS,
  placeRows,
  sectionCount,
  type SectionWidget,
  shellHoldsCurve,
  skinLayout,
  vfxLayout,
  voiceLinesLayout,
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

const list = (len: number): BinValue => ({
  type: "container",
  len,
  itemKind: "embed",
});
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
    expect(classLayout(nameHash("AnimationGraphData"))).toBe(animationGraphLayout);
    expect(classLayout(nameHash("CharacterRecord"))).toBeUndefined();
  });

  it("opens the TFT skin in the skin layout, which the schema does not say derives it", () => {
    expect(classLayout(nameHash("TftSkinCharacterDataProperties"))).toBe(skinLayout);
  });

  it("opens any view controller in Atlas through the nearest base that has a layout", () => {
    const bases = [nameHash("LogicDriverViewControllerBase"), nameHash("ViewController")];

    expect(classLayout(nameHash("LogicDriverViewController"), bases)).toBe(atlasLayout);
    expect(classLayout(nameHash("LogicDriverViewController"))).toBeUndefined();
    expect(classLayout(nameHash("VfxSystemDefinitionData"), bases)).toBe(vfxLayout);
  });

  it("opens a UiPropertyLoadable in Atlas, and a UiComponent under it in nothing", () => {
    const bases = [nameHash("UiPropertyLoadable"), nameHash("PropertyLoadable")];

    expect(classLayout(nameHash("UiPropertyLoadable"))).toBe(atlasLoadableLayout);
    expect(classLayout(nameHash("UiComponent"), bases)).toBeUndefined();
  });

  it("opens every UI element in the element shell through the interface they all derive", () => {
    const bases = [
      nameHash("UiElementAssetData"),
      nameHash("UiElementData"),
      nameHash("UiElementIData"),
    ];

    expect(classLayout(nameHash("UiElementIconData"), bases)).toBe(elementLayout);
    expect(frameOf(elementLayout)).toBe("shell");
  });

  it("opens a GameFontDescription in the font shell", () => {
    expect(classLayout(nameHash("GameFontDescription"))).toBe(fontLayout);
    expect(frameOf(fontLayout)).toBe("shell");
  });
});

describe("frameOf", () => {
  it("gives a layout that names no shell the stack", () => {
    expect(frameOf(animationGraphLayout)).toBe("stack");
  });

  it("gives the particle system, the skin and the material the shells they declare", () => {
    expect(frameOf(vfxLayout)).toBe("shell");
    expect(frameOf(skinLayout)).toBe("shell");
    expect(frameOf(materialLayout)).toBe("shell");
  });
});

describe("shellHoldsCurve", () => {
  it("is the particle system's shell alone, which the dock stands in for elsewhere", () => {
    expect(shellHoldsCurve(vfxLayout)).toBe(true);
    expect(shellHoldsCurve(skinLayout)).toBe(false);
    expect(shellHoldsCurve(materialLayout)).toBe(false);
  });
});

describe("descentOf", () => {
  const widgets: SectionWidget[] = [
    "rows",
    "tree",
    "fields",
    "icons",
    "mesh",
    "override-rows",
    "effect-table",
    "emitters",
    "material-params",
    "material-samplers",
    "material-switches",
    "material-macros",
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
    field("shaderMacros", {
      type: "map",
      len: 3,
      keyKind: "string",
      valueKind: "string",
    }),
    field("techniques", list(1)),
    field("dynamicMaterial", { type: "null" }),
    field("childTechniques", list(0)),
  ];

  it("places every depth-zero row, and every one the layout does not name in Other", () => {
    const placed = placeRows(roots, materialLayout);

    const drawn = placed.flatMap((section) => section.rows.map((row) => row.name));
    expect([...new Set(drawn)].sort()).toEqual(roots.map((row) => row.name).sort());
    /* Passes and Techniques draw the one `techniques` row two ways. */
    expect(drawn.filter((name) => name === "techniques")).toHaveLength(2);

    const other = placed.at(-1);
    expect(other?.other).toBe(true);
    expect(other?.widget).toBeUndefined();
    expect(other?.rows.map((row) => row.name)).toEqual(["dynamicMaterial", "childTechniques"]);
  });

  it("marks every section of a headless layout headless, Other with them", () => {
    const voice = [field("mSituations", list(2)), field("mObjectPath")];

    expect(placeRows(voice, voiceLinesLayout).map((section) => section.headless)).toEqual([
      true,
      true,
    ]);
    expect(placeRows(roots, materialLayout).some((section) => section.headless)).toBe(false);
    expect(placeRows(voice, voiceLinesLayout).at(-1)?.rows).toEqual([]);
  });

  it("draws the sections in the layout's order and names each one", () => {
    const placed = placeRows(roots, materialLayout);

    expect(placed.map((section) => section.title())).toEqual([
      "Identity",
      "Samplers",
      "Params",
      "Switches",
      "Macros",
      "Passes",
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

  it("places each default in the field section that names it, and the rest in Other", () => {
    const fallback = (name: string) => ({ hash: nameHash(name), name, declared: null });
    const defaults = ["flags", "complexEmitterDefinitionData", "transform"].map(fallback);

    const placed = placeRows([field("particleName")], vfxLayout, defaults);

    expect(placed[0]?.defaults.map((each) => each.name)).toEqual(["flags"]);
    expect(placed[1]?.defaults).toEqual([]);
    expect(placed.at(-1)?.defaults.map((each) => each.name)).toEqual(["transform"]);
  });

  it("names a widget only where the layout does, and none for Other", () => {
    const placed = placeRows(roots, materialLayout);

    expect(placed.map((section) => section.widget)).toEqual([
      undefined,
      "material-samplers",
      "material-params",
      "material-switches",
      "material-macros",
      "material-passes",
      "tree",
      undefined,
    ]);
  });

  it("gives each section an id of its own", () => {
    const placed = placeRows(roots, materialLayout);

    expect(new Set(placed.map((section) => section.id)).size).toBe(placed.length);
  });

  it("counts a list section's elements and Other's fields, and nothing for named fields", () => {
    const placed = placeRows(roots, materialLayout);
    const counts = placed.map((section) => sectionCount(section, new Map()));

    expect(counts).toEqual([null, 2, 1, 0, 3, null, null, 2]);
  });
});

describe("placeRows over a skin", () => {
  const roots = [
    field("championSkinName"),
    field("skinMeshProperties", embed("SkinMeshDataProperties", 38)),
    field("idleParticlesEffects", list(2)),
    field("mResourceResolver", {
      type: "objectLink",
      hash: "0x11223344",
      name: null,
    }),
    field("healthBarData", embed("CharacterHealthBarDataRecord", 4)),
    field("emoteLoadout", list(3)),
  ];

  it("places the mesh row in both the sections that draw a part of it", () => {
    const placed = placeRows(roots, skinLayout);
    const mesh = placed.filter((section) =>
      section.rows.some((row) => row.name === "skinMeshProperties"),
    );

    expect(mesh.map((section) => section.widget)).toEqual(["mesh", "override-rows"]);
  });

  it("leaves a field no section names to Other, the mesh included once it is placed", () => {
    const placed = placeRows(roots, skinLayout);

    expect(placed.at(-1)?.rows.map((row) => row.name)).toEqual(["emoteLoadout"]);
  });

  it("gives the health bar a section of its own", () => {
    const placed = placeRows(roots, skinLayout);
    const bar = placed.find((section) => section.title() === "Health bar");

    expect(bar?.rows.map((row) => row.name)).toEqual(["healthBarData"]);
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
