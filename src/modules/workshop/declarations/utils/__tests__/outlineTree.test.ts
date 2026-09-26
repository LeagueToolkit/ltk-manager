import { describe, expect, it } from "vitest";

import type { DeclarationsLayer, DeclaredModule } from "@/lib/tauri";

import { selectionOf } from "../lineSpan";
import {
  addItemId,
  ancestorIds,
  emptyItemId,
  entryItemId,
  flattenOutline,
  keyItemId,
  layerItemId,
  linkItemId,
  moduleItemId,
  moduleTally,
  moduleTitle,
  outlineBranchIds,
  overrideItemId,
  pathColumn,
  pathSegments,
  toggleOutlineSubtree,
} from "../outlineTree";

const LAYER: DeclarationsLayer = {
  layer: "base",
  file: "game_data.yaml",
  text: "",
  error: null,
  modules: [
    {
      index: 0,
      name: null,
      note: null,
      selector: "entries",
      target: null,
      targetHash: null,
      source: null,
      overrides: [],
      links: { add: [], remove: [] },
      span: null,
      entries: [
        {
          name: "A/B",
          knownName: null,
          hash: "0x00000001",
          edit: 0,
          object: null,
          span: null,
          keys: [{ key: "a", sign: "set", path: "a", value: "1", row: "", span: null }],
          links: { add: [], remove: [] },
        },
      ],
    },
  ],
};

const EMPTY: DeclarationsLayer = { ...LAYER, layer: "chroma", file: null, modules: [] };

describe("flattenOutline", () => {
  it("draws a layer row above its modules and skips a layer with no manifest", () => {
    const rows = flattenOutline([LAYER, EMPTY], () => false, {
      layers: true,
      keys: false,
      adds: false,
    });

    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      [layerItemId("base"), 0],
      [moduleItemId("base", 0), 1],
      [entryItemId("base", 0, 0), 2],
    ]);
  });

  it("ends every layer with a New module line where the shape adds, a layer with no manifest too", () => {
    const rows = flattenOutline([LAYER, EMPTY], () => false, {
      layers: true,
      keys: false,
      adds: true,
    });

    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      [layerItemId("base"), 0],
      [moduleItemId("base", 0), 1],
      [entryItemId("base", 0, 0), 2],
      [addItemId("base"), 1],
      [layerItemId("chroma"), 0],
      [addItemId("chroma"), 1],
    ]);
  });

  it("draws a line under a module that declares nothing", () => {
    const empty = { ...LAYER.modules[0]!, name: "Particles", entries: [] };
    const rows = flattenOutline([{ ...LAYER, modules: [empty] }], () => false, {
      layers: false,
      keys: true,
      adds: false,
    });

    expect(rows.map((row) => row.node.id)).toEqual([
      moduleItemId("base", 0),
      emptyItemId("base", 0),
    ]);
  });

  it("leaves a shut branch's children out", () => {
    const shut = moduleItemId("base", 0);
    const rows = flattenOutline([LAYER], (id) => id === shut, {
      layers: false,
      keys: true,
      adds: false,
    });

    expect(rows.map((row) => row.node.id)).toEqual([shut]);
  });
});

const TARGET: DeclaredModule = {
  ...LAYER.modules[0]!,
  index: 1,
  selector: "target",
  target: "data/maps/shipping/map11/map11.bin",
  targetHash: "00112233aabbccdd",
  overrides: ["overrides/a.ptch"],
  links: { add: ["DATA/A.bin"], remove: ["DATA/B.bin"] },
  entries: [
    {
      ...LAYER.modules[0]!.entries[0]!,
      name: "Mods/jade/Switch",
      object: { kind: "construct", class: "0xb9ce95d8", knownClass: null },
      keys: [],
    },
    {
      ...LAYER.modules[0]!.entries[0]!,
      name: "Mods/jade/Old",
      object: { kind: "remove" },
      keys: [],
    },
  ],
};

describe("flattenOutline with overrides and links", () => {
  it("draws overrides first and links last, in the order a build applies them", () => {
    const layer = { ...LAYER, modules: [TARGET] };
    const rows = flattenOutline([layer], () => false, { layers: false, keys: true, adds: false });

    expect(rows.map((row) => row.node.id)).toEqual([
      moduleItemId("base", 1),
      overrideItemId("base", 1, 0),
      entryItemId("base", 1, 0),
      entryItemId("base", 1, 1),
      linkItemId("base", 1, -1, "remove", 0),
      linkItemId("base", 1, -1, "add", 0),
    ]);
  });

  it("names the module above a module link and the entry above an entry link", () => {
    expect(ancestorIds(linkItemId("base", 1, -1, "add", 0))).toEqual([
      layerItemId("base"),
      moduleItemId("base", 1),
    ]);
    expect(ancestorIds(linkItemId("base", 1, 2, "add", 0))).toEqual([
      layerItemId("base"),
      moduleItemId("base", 1),
      entryItemId("base", 1, 2),
    ]);
  });
});

describe("moduleTally", () => {
  it("counts edited, created and removed entries, keys, links and overrides", () => {
    expect(moduleTally(TARGET)).toEqual({
      edited: 0,
      created: 1,
      removed: 1,
      keys: 0,
      links: 2,
      overrides: 1,
    });
  });
});

describe("pathColumn", () => {
  it("is as wide as the longest signed key, up to a cap", () => {
    const key = LAYER.modules[0]!.entries[0]!.keys[0]!;
    const layer = (spelled: string) => ({
      ...LAYER,
      modules: [
        {
          ...LAYER.modules[0]!,
          entries: [{ ...LAYER.modules[0]!.entries[0]!, keys: [{ ...key, key: spelled }] }],
        },
      ],
    });

    expect(pathColumn([layer("+resourceMap")])).toBe(12);
    expect(pathColumn([layer("a".repeat(200))])).toBe(56);
  });
});

describe("pathSegments", () => {
  it("splits at the dots outside a map key", () => {
    expect(pathSegments("skinMeshProperties.OutlineCategorySubmeshes")).toEqual([
      "skinMeshProperties",
      "OutlineCategorySubmeshes",
    ]);
    expect(pathSegments('a{"b.c"}.d[0].e')).toEqual(['a{"b.c"}', "d[0]", "e"]);
  });
});

describe("moduleTitle", () => {
  it("names a module by its own name, else by its place", () => {
    const module = LAYER.modules[0];

    expect(moduleTitle({ ...module, name: "Base look" })).toBe("Base look");
    expect(moduleTitle({ ...module, index: 2 })).toBe("Module 3");
  });
});

describe("ancestorIds", () => {
  it("names every branch above a key", () => {
    expect(ancestorIds(keyItemId("base", 2, 3, 4))).toEqual([
      layerItemId("base"),
      moduleItemId("base", 2),
      entryItemId("base", 2, 3),
    ]);
  });
});

describe("selectionOf", () => {
  it("counts a column in characters and stops a span before the next line", () => {
    const text = "a: 1\nbé: 2\nc: 3\n";

    expect(selectionOf(text, { line: 2, column: 1, endLine: 3, endColumn: 1 })).toEqual([5, 10]);
    expect(selectionOf(text, { line: 2, column: 3, endLine: 2, endColumn: 4 })).toEqual([7, 8]);
  });
});

describe("toggleOutlineSubtree", () => {
  const shape = { layers: true, keys: true, adds: false };
  const branches = outlineBranchIds([LAYER], shape);
  const layer = layerItemId("base");
  const module = moduleItemId("base", 0);
  const entry = entryItemId("base", 0, 0);

  it("names the layer, the module and the entry with keys as branches", () => {
    expect(branches).toEqual([layer, module, entry]);
  });

  it("collapses an expanded branch with every branch below it", () => {
    expect([...toggleOutlineSubtree(new Set(), module, branches)]).toEqual([module, entry]);
  });

  it("expands a collapsed branch with every branch below it", () => {
    const collapsed = new Set([layer, module, entry]);
    expect([...toggleOutlineSubtree(collapsed, module, branches)]).toEqual([layer]);
  });
});
