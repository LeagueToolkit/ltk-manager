import { describe, expect, it } from "vitest";

import type { AppError, BinRow } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  ancestorKeys,
  canExpand,
  childCount,
  entryKeyHash,
  fieldHash,
  flattenRows,
  isUnder,
  type LoadedChildren,
  mergePages,
  PAGE_SIZE,
  pagesWanted,
  rowKey,
  toggled,
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
const PART_NAME = row({
  path: "0000000b[1].0000000c",
  label: "items[1].name",
  name: "name",
});

function loaded(rows: BinRow[], total = rows.length, pending = false): LoadedChildren {
  return { rows, total, pending };
}

function keysOf(visible: ReturnType<typeof flattenRows>): string[] {
  return visible.map((line) => line.key);
}

describe("flattenRows", () => {
  it("lists a collapsed root as one line whatever it holds", () => {
    const visible = flattenRows([OBJECT], new Set(), () => undefined);

    expect(keysOf(visible)).toEqual([`${ENTRY}:`]);
    expect(visible[0]).toMatchObject({ kind: "row", depth: 0, expanded: false, loading: false });
  });

  it("draws an expanded node as loading until its first page answers", () => {
    const visible = flattenRows([OBJECT], new Set([rowKey(OBJECT)]), () => undefined);

    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ kind: "row", expanded: true, loading: true });
  });

  it("nests the fetched children under their parent, one depth down", () => {
    const children = new Map([[rowKey(OBJECT), loaded([SIZE, ITEMS])]]);
    const visible = flattenRows([OBJECT], new Set([rowKey(OBJECT)]), (key) => children.get(key));

    expect(keysOf(visible)).toEqual([`${ENTRY}:`, `${ENTRY}:0000000a`, `${ENTRY}:0000000b`]);
    expect(visible.map((line) => line.depth)).toEqual([0, 1, 1]);
  });

  it("recurses through an expanded container to its elements", () => {
    const expanded = new Set([rowKey(OBJECT), rowKey(ITEMS)]);
    const children = new Map([
      [rowKey(OBJECT), loaded([SIZE, ITEMS])],
      [rowKey(ITEMS), loaded([ITEM(0), ITEM(1), ITEM(2)])],
    ]);
    const visible = flattenRows([OBJECT], expanded, (key) => children.get(key));

    expect(keysOf(visible)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000b`,
      `${ENTRY}:0000000b[0]`,
      `${ENTRY}:0000000b[1]`,
      `${ENTRY}:0000000b[2]`,
    ]);
    expect(visible[5]?.depth).toBe(2);
  });

  it("asks for the rest of a node whose pages have not covered its total", () => {
    const expanded = new Set([rowKey(OBJECT), rowKey(ITEMS)]);
    const children = new Map([
      [rowKey(OBJECT), loaded([ITEMS])],
      [rowKey(ITEMS), loaded([ITEM(0), ITEM(1)], 3, true)],
    ]);
    const visible = flattenRows([OBJECT], expanded, (key) => children.get(key));

    expect(visible.at(-1)).toEqual({
      kind: "more",
      key: `${ENTRY}:0000000b:more`,
      parent: `${ENTRY}:0000000b`,
      depth: 2,
      loaded: 2,
      total: 3,
      pending: true,
    });
  });

  it("names the class a property is read on, and none for an element", () => {
    const expanded = new Set([rowKey(OBJECT), rowKey(ITEMS), rowKey(ITEM(1))]);
    const children = new Map([
      [rowKey(OBJECT), loaded([SIZE, ITEMS])],
      [rowKey(ITEMS), loaded([ITEM(0), ITEM(1)])],
      [rowKey(ITEM(1)), loaded([PART_NAME])],
    ]);
    const visible = flattenRows([OBJECT], expanded, (key) => children.get(key));

    const owners = visible.map((line) => (line.kind === "row" ? line.owner : "more"));
    expect(owners).toEqual([null, "0x9b67e9f6", "0x9b67e9f6", null, null, "0x0000beef"]);
  });

  it("ignores an expansion on a row nothing can sit under", () => {
    const children = new Map([[rowKey(OBJECT), loaded([SIZE])]]);
    const expanded = new Set([rowKey(OBJECT), rowKey(SIZE)]);
    const visible = flattenRows([OBJECT], expanded, (key) => children.get(key));

    expect(visible[1]).toMatchObject({ key: `${ENTRY}:0000000a`, expanded: false, loading: false });
  });
});

describe("canExpand", () => {
  it("opens a struct, a container and a map that hold something, and a present optional", () => {
    expect(canExpand(OBJECT)).toBe(true);
    expect(canExpand(ITEMS)).toBe(true);
    expect(
      canExpand(row({ value: { type: "map", len: 1, keyKind: "hash", valueKind: "string" } })),
    ).toBe(true);
    expect(canExpand(row({ value: { type: "optional", present: true, itemKind: "f32" } }))).toBe(
      true,
    );
  });

  it("keeps a leaf, a null, an empty container and an absent optional shut", () => {
    expect(canExpand(SIZE)).toBe(false);
    expect(canExpand(row({ value: { type: "null" } }))).toBe(false);
    expect(canExpand(row({ value: { type: "container", len: 0, itemKind: "u8" } }))).toBe(false);
    expect(canExpand(row({ value: { type: "optional", present: false, itemKind: "u8" } }))).toBe(
      false,
    );
    expect(
      canExpand(row({ value: { type: "struct", classHash: "0x1", class: null, len: 0 } })),
    ).toBe(false);
  });
});

describe("fieldHash", () => {
  it("reads the field a property path ends in, at the root and under a segment", () => {
    expect(fieldHash("9c4e1b02")).toBe("0x9c4e1b02");
    expect(fieldHash("0000000b[1].1a2b3c4d")).toBe("0x1a2b3c4d");
    expect(fieldHash('0000000b{"weapon"}.deadbeef')).toBe("0xdeadbeef");
  });
});

describe("entryKeyHash", () => {
  it("takes the hex of a key no table names", () => {
    expect(entryKeyHash({ name: "0xAABBCCDD", unnamed: true })).toBe("0xaabbccdd");
  });

  it("hashes the name a table gave a key back to what the key held", () => {
    expect(entryKeyHash({ name: '"Smolder_Base_Idle"', unnamed: false })).toBe(
      nameHash("Smolder_Base_Idle"),
    );
  });

  it("answers nothing for a key that is no hash", () => {
    expect(entryKeyHash({ name: "3", unnamed: false })).toBeNull();
    expect(entryKeyHash({ name: "not hex", unnamed: true })).toBeNull();
  });
});

describe("toggled", () => {
  it("adds a key that is absent and removes one that is present", () => {
    const once = toggled(new Set(), "a");
    expect([...once]).toEqual(["a"]);
    expect([...toggled(once, "a")]).toEqual([]);
  });
});

describe("mergePages", () => {
  const page = (rows: BinRow[], total: number) => ({ data: { rows, total } });
  const notOpen: AppError = { code: "BIN_NOT_OPEN" };

  it("is nothing until the first page answers", () => {
    expect(mergePages([{}])).toBeUndefined();
    expect(mergePages([])).toBeUndefined();
  });

  it("concatenates the answered pages in order and keeps the total", () => {
    const merged = mergePages([page([ITEM(0), ITEM(1)], 3), page([ITEM(2)], 3)]);

    expect(merged).toEqual({
      rows: [ITEM(0), ITEM(1), ITEM(2)],
      total: 3,
      pending: false,
      error: undefined,
    });
  });

  it("ends the rows at a page that has not answered and reads as pending", () => {
    const merged = mergePages([page([ITEM(0)], 3), {}, page([ITEM(2)], 3)]);

    expect(merged).toMatchObject({ rows: [ITEM(0)], total: 3, pending: true });
  });

  it("carries a failed page's error, with nothing under it when it was the first", () => {
    expect(mergePages([{ error: notOpen }])).toEqual({
      rows: [],
      total: 0,
      pending: false,
      error: notOpen,
    });
    expect(mergePages([page([ITEM(0)], 3), { error: notOpen }])).toMatchObject({
      rows: [ITEM(0)],
      error: notOpen,
    });
  });
});

describe("pagesWanted", () => {
  it("asks for one page past what a whole number of pages answered", () => {
    expect(pagesWanted(0)).toBe(1);
    expect(pagesWanted(PAGE_SIZE)).toBe(2);
    expect(pagesWanted(PAGE_SIZE * 2)).toBe(3);
  });
});

describe("isUnder", () => {
  it("holds for a node and what sits under it, and not for a sibling sharing a prefix", () => {
    expect(isUnder("0x1:", "0x1:")).toBe(true);
    expect(isUnder("0x1:", "0x1:aaaaaaaa[3]")).toBe(true);
    expect(isUnder("0x1:aaaaaaaa", "0x1:aaaaaaaa.bbbbbbbb")).toBe(true);
    expect(isUnder("0x1:aaaaaaaa[3]", "0x1:aaaaaaaa[3].bbbbbbbb")).toBe(true);
    expect(isUnder("0x1:aaaaaaaa[3]", "0x1:aaaaaaaa[30]")).toBe(false);
    expect(isUnder("0x1:aaaaaaaa", "0x2:aaaaaaaa")).toBe(false);
  });
});

describe("childCount", () => {
  it("counts what sits under a container, a map, a struct and an option", () => {
    expect(childCount(row({ value: { type: "container", len: 8, itemKind: "embed" } }))).toBe(8);
    expect(
      childCount(row({ value: { type: "map", len: 2, keyKind: "hash", valueKind: "string" } })),
    ).toBe(2);
    expect(
      childCount(row({ value: { type: "struct", classHash: "0x1", class: null, len: 3 } })),
    ).toBe(3);
    expect(childCount(row({ value: { type: "optional", present: true, itemKind: "f32" } }))).toBe(
      1,
    );
    expect(childCount(row({ value: { type: "optional", present: false, itemKind: "f32" } }))).toBe(
      0,
    );
  });

  it("counts nothing under a leaf", () => {
    expect(childCount(row({ value: { type: "float", value: 1 } }))).toBe(0);
  });
});

describe("ancestorKeys", () => {
  it("walks a field path down to the row, the object's own key first", () => {
    expect(ancestorKeys(`${ENTRY}:0000000a[3].0000000b`)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000a[3]`,
      `${ENTRY}:0000000a[3].0000000b`,
    ]);
  });

  it("answers the object's own key for the object itself", () => {
    expect(ancestorKeys(`${ENTRY}:`)).toEqual([`${ENTRY}:`]);
  });

  it("walks a map key, bare and quoted, as one segment", () => {
    expect(ancestorKeys(`${ENTRY}:0000000a{7}.0000000b`)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000a{7}`,
      `${ENTRY}:0000000a{7}.0000000b`,
    ]);
    expect(ancestorKeys(`${ENTRY}:0000000a{"we}ird"}`)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000a{"we}ird"}`,
    ]);
  });

  /* Every ancestor opens, so a reveal of a row nobody can reach still opens what it can. */
  it("answers what it reached for a path it cannot read, the key itself last", () => {
    expect(ancestorKeys(`${ENTRY}:0000000a[3`)).toEqual([
      `${ENTRY}:`,
      `${ENTRY}:0000000a`,
      `${ENTRY}:0000000a[3`,
    ]);
  });
});
