import { m } from "@/i18n";
import type { BinRow, BinValue, LeafValue } from "@/lib/tauri";

import type { LayoutPages } from "../../classes/components/ClassCells";
import { fieldHash, rowKey } from "../../tree/utils/binRows";

/** A material list row's own entry: whether the material has one, and the leaves it writes. */
export interface RowSnapshot {
  readonly present: boolean;
  /** Each written leaf field of the entry, by field hash. */
  readonly fields: ReadonlyMap<string, LeafValue>;
}

const ABSENT: RowSnapshot = { present: false, fields: new Map() };

/** The value a leaf row draws, as the edit that writes it spells it. Null for a non-leaf. */
export function leafOf(value: BinValue): LeafValue | null {
  switch (value.type) {
    case "bool":
    case "integer":
    case "float":
    case "vector":
    case "matrix":
    case "color":
    case "string":
      return value;
    case "hash":
    case "objectLink":
      return { type: value.type, text: value.hash };
    case "wadChunkLink":
      return { type: "wadChunkLink", text: value.hash };
    default:
      return null;
  }
}

/** The entry `element` as the read answered it, or null while its fields are unread. */
export function snapshotOf(element: BinRow | null, pages: LayoutPages): RowSnapshot | null {
  if (element === null) return ABSENT;

  const page = pages.get(rowKey(element));
  if (page === undefined) return null;

  const fields = new Map<string, LeafValue>();
  for (const row of page.rows) {
    const leaf = leafOf(row.value);
    if (leaf !== null) fields.set(fieldHash(row.path), leaf);
  }
  return { present: true, fields };
}

function sameLeaf(a: LeafValue | undefined, b: LeafValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The fields whose value differs between `from` and `to`, in `from`'s order then `to`'s. */
export function changedFields(from: RowSnapshot, to: RowSnapshot): string[] {
  const fields = new Set([...from.fields.keys(), ...to.fields.keys()]);
  return [...fields].filter((field) => !sameLeaf(from.fields.get(field), to.fields.get(field)));
}

/** Whether two snapshots are one entry state. */
export function sameSnapshot(a: RowSnapshot, b: RowSnapshot): boolean {
  return a.present === b.present && changedFields(a, b).length === 0;
}

/** A leaf as a short reading, three decimals at most. */
export function leafText(leaf: LeafValue, on: string, off: string): string {
  const number = (value: number | null) => String(Number((value ?? 0).toFixed(3)));
  switch (leaf.type) {
    case "bool":
      return leaf.value ? on : off;
    case "integer":
      return leaf.text;
    case "float":
      return number(leaf.value);
    case "vector":
    case "matrix":
      return leaf.values.map(number).join(", ");
    case "color":
      return [leaf.r, leaf.g, leaf.b, leaf.a].join(", ");
    case "string":
      return leaf.value;
    case "hash":
    case "wadChunkLink":
    case "objectLink":
      return leaf.text;
  }
}

/** The fields a revert writes back: each baseline field the entry no longer holds as it did. */
export function revertFields(
  baseline: RowSnapshot,
  current: RowSnapshot,
  nameField: string,
): [string, LeafValue][] {
  return changedFields(baseline, current).flatMap((field) => {
    const value = baseline.fields.get(field);
    return value === undefined || field === nameField ? [] : [[field, value]];
  });
}

/** What a revert returns the row to, as the go-back names it. */
export function revertLabel(
  baseline: RowSnapshot,
  current: RowSnapshot | null,
  nameField: string,
): string {
  if (!baseline.present) return m.workshop_bin_material_revert_default_action();

  const fields = current === null ? [] : revertFields(baseline, current, nameField);
  const on = m.workshop_bin_material_bool_on_label();
  const off = m.workshop_bin_material_bool_off_label();
  const value = fields.map(([, leaf]) => leafText(leaf, on, off)).join(" / ");
  if (value.length === 0) return m.workshop_bin_material_revert_default_action();

  return m.workshop_bin_material_revert_action({ value });
}
