import type { BinRow, LeafValue, ValueEdit } from "@/lib/tauri";

/** The object as the holder an edit of one of its own fields is addressed under. */
export function objectRow(entry: string): BinRow {
  return {
    entry,
    path: "",
    label: "",
    node: "object",
    name: entry,
    unnamed: true,
    kind: null,
    value: { type: "objectLink", hash: entry, name: null },
    declared: null,
  };
}

/** Write `value` into `field` of the item at `at`, adding the field where the item lacks it. */
export function setField(at: string, field: string, value: LeafValue): ValueEdit[] {
  return [
    { type: "ensureProperty", path: at, field },
    { type: "setLeaf", path: `${at}.${field.slice(2)}`, value },
  ];
}

/** The position of a list entry, as the last step of its path spells it. */
export function itemStep(element: BinRow): string | null {
  return /\[\d+\]$/.exec(element.path)?.[0] ?? null;
}
