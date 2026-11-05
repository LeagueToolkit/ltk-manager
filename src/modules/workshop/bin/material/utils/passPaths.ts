import type { BinRow } from "@/lib/tauri";

import type { LayoutPages } from "../../classes/components/ClassCells";
import { nameHash } from "../../shared/utils/binHash";
import { fieldHash, rowKey } from "../../tree/utils/binRows";

const TECHNIQUES = nameHash("techniques");
const PASSES = nameHash("passes");

/** `paramValues`, the list a material and each of its passes hold their parameter entries in. */
export const PARAM_VALUES = nameHash("paramValues");

/** The fields of a `StaticMaterialShaderParamDef`, by hash. */
export const PARAM_FIELD = { name: nameHash("name"), value: nameHash("value") } as const;

/** The row of `field` under `row`, as the read answered it. */
export function fieldOf(pages: LayoutPages, row: BinRow, field: string): BinRow | undefined {
  return pages.get(rowKey(row))?.rows.find((child) => fieldHash(child.path) === field);
}

/** The wire path of the pass at `pass` of the technique at `technique`. */
export function passPath(technique: number, pass: number): string {
  return `${TECHNIQUES.slice(2)}[${technique}].${PASSES.slice(2)}[${pass}]`;
}

/**
 * The first entry of each name of a `paramValues` list, as the shader reads them, out of the
 * read's pages. An entry whose name is unread is left out.
 */
export function entriesByName(
  elements: readonly BinRow[],
  pages: LayoutPages,
  nameField: string,
): Map<string, BinRow> {
  const byName = new Map<string, BinRow>();
  for (const element of elements) {
    const name = fieldOf(pages, element, nameField)?.value;
    if (name?.type === "string" && !byName.has(name.value)) byName.set(name.value, element);
  }
  return byName;
}

/** The components an entry's `value` holds, or null where it holds no vector or is unread. */
export function entryValues(
  element: BinRow,
  pages: LayoutPages,
  valueField: string,
): number[] | null {
  const value = fieldOf(pages, element, valueField)?.value;
  return value?.type === "vector" ? value.values.map((each) => each ?? 0) : null;
}
