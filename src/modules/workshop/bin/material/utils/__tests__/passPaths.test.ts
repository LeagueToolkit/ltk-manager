import { describe, expect, it } from "vitest";

import type { BinRow, BinRows, BinValue } from "@/lib/tauri";

import { nameHash } from "../../../shared/utils/binHash";
import { rowKey } from "../../../tree/utils/binRows";
import { entriesByName, entryValues, passPath } from "../passPaths";

const ENTRY = "0x11223344";
const NAME = nameHash("name");
const VALUE = nameHash("value");

function row(path: string, value: BinValue): BinRow {
  return {
    entry: ENTRY,
    path,
    label: path,
    node: "property",
    name: path,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

function page(rows: BinRow[]): BinRows {
  return { rows, total: rows.length } as BinRows;
}

/** One `StaticMaterialShaderParamDef` at `[index]` of a list, with its fields' page. */
function entry(index: number, name: string, values: number[] | null) {
  const element = row(`d0ab46b8[${index}]`, {
    type: "struct",
    classHash: "0x0",
    class: null,
    len: 2,
  });
  const fields = [row(`${element.path}.${NAME.slice(2)}`, { type: "string", value: name })];
  if (values !== null) {
    fields.push(row(`${element.path}.${VALUE.slice(2)}`, { type: "vector", values }));
  }
  return { element, page: [rowKey(element), page(fields)] as const };
}

describe("passPath", () => {
  it("spells the pass under its technique in the wire grammar", () => {
    expect(passPath(1, 2)).toBe(
      `${nameHash("techniques").slice(2)}[1].${nameHash("passes").slice(2)}[2]`,
    );
  });
});

describe("entriesByName", () => {
  it("keeps the first entry of each name, as the shader reads them", () => {
    const first = entry(0, "Tint", [1, 2, 3, 4]);
    const second = entry(1, "Tint", [5, 6, 7, 8]);
    const other = entry(2, "Bloom", null);
    const pages = new Map([first.page, second.page, other.page]);

    const byName = entriesByName([first.element, second.element, other.element], pages, NAME);

    expect([...byName.keys()]).toEqual(["Tint", "Bloom"]);
    expect(byName.get("Tint")).toBe(first.element);
    expect(entryValues(first.element, pages, VALUE)).toEqual([1, 2, 3, 4]);
    expect(entryValues(other.element, pages, VALUE)).toBeNull();
  });

  it("leaves out an entry whose fields are unread", () => {
    const unread = entry(0, "Tint", [1, 1, 1, 1]);

    expect(entriesByName([unread.element], new Map(), NAME).size).toBe(0);
  });
});
