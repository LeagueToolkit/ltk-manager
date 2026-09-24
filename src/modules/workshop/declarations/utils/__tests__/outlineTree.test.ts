import { describe, expect, it } from "vitest";

import type { DeclarationsLayer } from "@/lib/tauri";

import { selectionOf } from "../lineSpan";
import {
  ancestorIds,
  entryItemId,
  flattenOutline,
  keyItemId,
  layerItemId,
  moduleItemId,
  moduleTitle,
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
      selector: "entries",
      target: null,
      targetHash: null,
      source: null,
      overrides: [],
      span: null,
      entries: [
        {
          name: "A/B",
          hash: "0x00000001",
          edit: 0,
          object: null,
          span: null,
          keys: [{ key: "a", sign: "set", path: "a", value: "1", row: "", span: null }],
        },
      ],
    },
  ],
};

const EMPTY: DeclarationsLayer = { ...LAYER, layer: "chroma", file: null, modules: [] };

describe("flattenOutline", () => {
  it("draws a layer row above its modules and skips a layer with no manifest", () => {
    const rows = flattenOutline([LAYER, EMPTY], () => false, { layers: true, keys: false });

    expect(rows.map((row) => [row.node.id, row.depth])).toEqual([
      [layerItemId("base"), 0],
      [moduleItemId("base", 0), 1],
      [entryItemId("base", 0, 0), 2],
    ]);
  });

  it("leaves a shut branch's children out", () => {
    const shut = moduleItemId("base", 0);
    const rows = flattenOutline([LAYER], (id) => id === shut, { layers: false, keys: true });

    expect(rows.map((row) => row.node.id)).toEqual([shut]);
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
