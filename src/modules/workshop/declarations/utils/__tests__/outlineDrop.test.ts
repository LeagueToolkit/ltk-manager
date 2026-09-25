import { describe, expect, it } from "vitest";

import type { DeclaredEntry, DeclaredModule } from "@/lib/tauri";

import { dropTarget, isDraggable } from "../outlineDrop";
import { entryItemId, moduleItemId, type OutlineNode } from "../outlineTree";

const ENTRY: DeclaredEntry = {
  name: "Characters/Teemo/Skins/Skin0",
  knownName: null,
  hash: "0x1234abcd",
  edit: 0,
  object: null,
  span: null,
  keys: [],
  links: { add: [], remove: [] },
};

function module(index: number, selector: DeclaredModule["selector"]): DeclaredModule {
  return {
    index,
    name: null,
    note: null,
    selector,
    target: selector === "target" ? "data/a.bin" : null,
    targetHash: null,
    source: null,
    overrides: [],
    links: { add: [], remove: [] },
    span: null,
    entries: [ENTRY],
  };
}

const moduleRow = (at: DeclaredModule, layer = "base"): OutlineNode => ({
  type: "module",
  id: moduleItemId(layer, at.index),
  layer,
  module: at,
});

const entryRow = (at: DeclaredModule, layer = "base"): OutlineNode => ({
  type: "entry",
  id: entryItemId(layer, at.index, 0),
  layer,
  module: at,
  entry: ENTRY,
});

describe("dropTarget", () => {
  it("places a module above one ahead of it and below one after it", () => {
    const first = module(0, "entries");
    const second = module(1, "entries");
    const third = module(2, "entries");

    expect(dropTarget(moduleRow(second), moduleRow(first))?.placement).toBe("above");
    expect(dropTarget(moduleRow(second), entryRow(third))?.placement).toBe("below");
    expect(dropTarget(moduleRow(second), moduleRow(second))).toBeNull();
  });

  it("drops an entry into another entries module, never a target one", () => {
    const from = module(0, "entries");

    expect(dropTarget(entryRow(from), moduleRow(module(1, "entries")))).toMatchObject({
      moduleId: moduleItemId("base", 1),
      placement: "into",
    });
    expect(dropTarget(entryRow(from), moduleRow(module(1, "target")))).toBeNull();
    expect(dropTarget(entryRow(from), entryRow(from))).toBeNull();
  });

  it("crosses no layer", () => {
    expect(
      dropTarget(entryRow(module(0, "entries")), moduleRow(module(1, "entries"), "chroma")),
    ).toBeNull();
  });
});

describe("isDraggable", () => {
  it("picks up a module and an entries module's entry, not a target module's", () => {
    expect(isDraggable(moduleRow(module(0, "target")))).toBe(true);
    expect(isDraggable(entryRow(module(0, "entries")))).toBe(true);
    expect(isDraggable(entryRow(module(0, "target")))).toBe(false);
  });
});
