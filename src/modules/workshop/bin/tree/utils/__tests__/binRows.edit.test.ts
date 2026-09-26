import { describe, expect, it } from "vitest";

import type { BinDocumentId, BinRow } from "@/lib/tauri";

import {
  canExpand,
  droppedInside,
  droppedUnder,
  flattenRows,
  insertShift,
  lineTarget,
  type LoadedChildren,
  moveShift,
  removeShift,
  renamedKey,
  reshapeRemap,
  rowKey,
  shiftedKey,
} from "../binRows";

const ENTRY = "0x2a1f3c7d";

function row(overrides: Partial<BinRow>): BinRow {
  return {
    entry: ENTRY,
    path: "",
    label: "",
    node: "property",
    name: "name",
    unnamed: false,
    kind: "string",
    value: { type: "string", value: "text" },
    declared: null,
    ...overrides,
  };
}

const OBJECT = row({
  node: "object",
  name: "Characters/Aatrox",
  kind: null,
  value: { type: "struct", classHash: "0x9b67e9f6", class: "CharacterRecord", len: 2 },
});
const SIZE = row({ path: "0000000a", label: "size", name: "size", kind: "u8" });
const ITEMS = row({
  path: "0000000b",
  label: "items",
  name: "items",
  kind: "list",
  value: { type: "container", len: 3, itemKind: "embed" },
});
const ITEM = (index: number) =>
  row({
    path: `0000000b[${index}]`,
    label: `items[${index}]`,
    name: `[${index}]`,
    node: "element",
    kind: "embed",
    value: { type: "struct", classHash: "0x0000beef", class: "Part", len: 1 },
  });
function loaded(rows: BinRow[], total = rows.length, pending = false): LoadedChildren {
  return { rows, total, pending };
}

function keysOf(visible: ReturnType<typeof flattenRows>): string[] {
  return visible.map((line) => line.key);
}

describe("the add lines of an editable tree", () => {
  const DOCUMENT = 4 as BinDocumentId;
  const EMPTY_PART = row({
    path: "0000000d",
    label: "part",
    name: "part",
    kind: "embed",
    value: { type: "struct", classHash: "0x0000beef", class: "Part", len: 0 },
  });

  it("closes an expanded holder and an expanded list each with a line that adds to it", () => {
    const expanded = new Set([rowKey(OBJECT), rowKey(ITEMS)]);
    const children = new Map([
      [rowKey(OBJECT), loaded([SIZE, ITEMS])],
      [rowKey(ITEMS), loaded([ITEM(0)])],
    ]);
    const visible = flattenRows([OBJECT], expanded, (key) => children.get(key), null, {
      document: DOCUMENT,
      rootEntry: null,
    });

    expect(keysOf(visible)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000b`,
      `${ENTRY}:0000000b[0]`,
      `${ENTRY}:0000000b:add`,
      `${ENTRY}::add`,
    ]);
    expect(visible[4]).toMatchObject({
      kind: "add",
      path: "0000000b",
      depth: 2,
      target: { kind: "item", itemKind: "embed" },
      index: null,
    });
    expect(visible.at(-1)).toMatchObject({
      kind: "add",
      entry: ENTRY,
      path: "",
      depth: 1,
      target: { kind: "property" },
    });
  });

  it("opens an empty holder, a null pointer and an absent option only where the tree edits", () => {
    const pointer = row({ kind: "pointer", value: { type: "null" } });
    const option = row({
      kind: "option",
      value: { type: "optional", present: false, itemKind: "f32" },
    });
    const list = row({ kind: "list", value: { type: "container", len: 0, itemKind: "u8" } });
    for (const shut of [EMPTY_PART, pointer, option, list]) {
      expect(canExpand(shut)).toBe(false);
      expect(canExpand(shut, true)).toBe(true);
    }
    expect(lineTarget(pointer.value)).toEqual({ kind: "pointer" });
    expect(lineTarget(option.value)).toEqual({ kind: "option", itemKind: "f32" });
    expect(lineTarget({ type: "map", len: 0, keyKind: "hash", valueKind: "embed" })).toEqual({
      kind: "entry",
      keyKind: "hash",
      valueKind: "embed",
    });
    expect(lineTarget({ type: "optional", present: true, itemKind: "f32" })).toBeNull();
  });

  it("gives every row its parent and its position", () => {
    const children = new Map([[rowKey(ITEMS), loaded([ITEM(0), ITEM(1)])]]);
    const visible = flattenRows([ITEMS], new Set([rowKey(ITEMS)]), (key) => children.get(key));

    expect(visible[0]).toMatchObject({ parent: null, index: 0 });
    expect(visible[2]).toMatchObject({ key: rowKey(ITEM(1)), parent: ITEMS, index: 1 });
  });

  it("draws an open insert line after the child before its index", () => {
    const children = new Map([[rowKey(ITEMS), loaded([ITEM(0), ITEM(1), ITEM(2)])]]);
    const visible = flattenRows(
      [ITEMS],
      new Set([rowKey(ITEMS)]),
      (key) => children.get(key),
      null,
      {
        document: DOCUMENT,
        rootEntry: null,
        insertAt: { holder: rowKey(ITEMS), index: 2 },
      },
    );

    expect(keysOf(visible)).toEqual([
      rowKey(ITEMS),
      rowKey(ITEM(0)),
      rowKey(ITEM(1)),
      `${ENTRY}:0000000b:add@2`,
      rowKey(ITEM(2)),
      `${ENTRY}:0000000b:add`,
    ]);
    expect(visible[3]).toMatchObject({ depth: 1, index: 2, target: { kind: "item" } });
  });

  it("draws no add line while a holder has pages to come", () => {
    const children = new Map([[rowKey(OBJECT), loaded([SIZE], 2, true)]]);
    const visible = flattenRows(
      [OBJECT],
      new Set([rowKey(OBJECT)]),
      (key) => children.get(key),
      null,
      { document: DOCUMENT, rootEntry: null },
    );
    expect(visible.some((line) => line.kind === "add")).toBe(false);
  });

  it("follows the roots of an object tab with a line that adds to the object", () => {
    const visible = flattenRows([SIZE], new Set(), () => undefined, "0x9b67e9f6", {
      document: DOCUMENT,
      rootEntry: ENTRY,
    });
    expect(visible.at(-1)).toMatchObject({ kind: "add", entry: ENTRY, path: "", depth: 0 });
  });
});

describe("the expanded keys an item edit carries", () => {
  const LIST = `${ENTRY}:0000000b`;

  it("moves the keys under later items down past an insert", () => {
    const shift = insertShift(1);
    expect(shiftedKey(`${LIST}[0]`, LIST, shift)).toBe(`${LIST}[0]`);
    expect(shiftedKey(`${LIST}[1].0000000c`, LIST, shift)).toBe(`${LIST}[2].0000000c`);
    expect(shiftedKey(`${ENTRY}:0000000a`, LIST, shift)).toBe(`${ENTRY}:0000000a`);
  });

  it("drops the keys under a removed item and closes the gap", () => {
    const shift = removeShift(1);
    expect(shiftedKey(`${LIST}[1]`, LIST, shift)).toBeNull();
    expect(shiftedKey(`${LIST}[1][0]`, LIST, shift)).toBeNull();
    expect(shiftedKey(`${LIST}[12]`, LIST, shift)).toBe(`${LIST}[11]`);
  });

  it("carries a moved item's keys along and closes up behind it", () => {
    const down = moveShift(0, 2);
    expect([0, 1, 2, 3].map(down)).toEqual([2, 0, 1, 3]);
    const up = moveShift(2, 0);
    expect([0, 1, 2, 3].map(up)).toEqual([1, 2, 0, 3]);
  });

  it("renames the keys under a rekeyed entry", () => {
    const from = `${ENTRY}:0000000e{"Idle"}`;
    const to = `${ENTRY}:0000000e{"Run"}`;
    expect(renamedKey(`${from}.0000000c`, from, to)).toBe(`${to}.0000000c`);
    expect(renamedKey(`${ENTRY}:0000000e{"Idler"}`, from, to)).toBe(`${ENTRY}:0000000e{"Idler"}`);
  });

  it("drops the keys under a node taken out, or only the ones inside it", () => {
    const item = `${LIST}[1]`;
    expect(droppedUnder(item)(item)).toBeNull();
    expect(droppedUnder(item)(`${item}.0000000c`)).toBeNull();
    expect(droppedInside(item)(item)).toBe(item);
    expect(droppedInside(item)(`${item}.0000000c`)).toBeNull();
    expect(droppedUnder(item)(`${LIST}[12]`)).toBe(`${LIST}[12]`);
  });
});

describe("the expanded keys an undo carries", () => {
  const LIST = `${ENTRY}:0000000b`;

  it("shifts a list's items for an item put back or taken out again", () => {
    const inserted = reshapeRemap({ kind: "inserted", entry: ENTRY, holder: "0000000b", index: 1 });
    expect(inserted?.(`${LIST}[1].0000000c`)).toBe(`${LIST}[2].0000000c`);

    const removed = reshapeRemap({ kind: "removed", entry: ENTRY, path: "0000000b[1]" });
    expect(removed?.(`${LIST}[1]`)).toBeNull();
    expect(removed?.(`${LIST}[3]`)).toBe(`${LIST}[2]`);
  });

  it("drops what sat under a removed property or a nulled pointer", () => {
    const removed = reshapeRemap({ kind: "removed", entry: ENTRY, path: "0000000b" });
    expect(removed?.(`${LIST}.0000000c`)).toBeNull();

    const nulled = reshapeRemap({ kind: "nulled", entry: ENTRY, path: "0000000b" });
    expect(nulled?.(LIST)).toBe(LIST);
    expect(nulled?.(`${LIST}.0000000c`)).toBeNull();
  });

  it("follows a moved item and a renamed key, and leaves an in-place undo alone", () => {
    const moved = reshapeRemap({ kind: "moved", entry: ENTRY, path: "0000000b[2]", to: 0 });
    expect(moved?.(`${LIST}[2]`)).toBe(`${LIST}[0]`);
    expect(moved?.(`${LIST}[0]`)).toBe(`${LIST}[1]`);

    const rekeyed = reshapeRemap({
      kind: "rekeyed",
      entry: ENTRY,
      from: '0000000e{"Idle"}',
      to: '0000000e{"Run"}',
    });
    expect(rekeyed?.(`${ENTRY}:0000000e{"Idle"}.0000000c`)).toBe(
      `${ENTRY}:0000000e{"Run"}.0000000c`,
    );

    expect(reshapeRemap({ kind: "inPlace" })).toBeNull();
  });
});
