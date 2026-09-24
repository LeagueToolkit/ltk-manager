import { use } from "react";

import type { BinRow, LeafValue, ValueEdit } from "@/lib/tauri";

import { fieldsOf } from "../../classes/components/ClassCells";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { rowKey } from "../../tree/utils/binRows";
import { TableContext } from "../state/declaredTable";
import { itemStep, objectRow, setField } from "../utils/entryEdits";

/** The field `field` of an entry, as the read answered it. */
export function useElementField(element: BinRow, field: string): BinRow | undefined {
  return fieldsOf(use(TableContext)?.pages.get(rowKey(element)))(field);
}

/** The `StaticMaterialDef` the table's list belongs to. */
export function useMaterialEntry(): string {
  return use(TableContext)?.view.entry ?? "";
}

/**
 * Add the material's own entry for the declaration `name`, at the end of its list, with the
 * fields `fill` writes. Null where the view does not edit.
 */
export function useOverride():
  | ((name: string, fill: (at: string) => ValueEdit[]) => Promise<boolean>)
  | null {
  const editProperty = use(LeafEditContext)?.editProperty;
  const table = use(TableContext);
  if (editProperty === undefined || table === null) return null;

  return (name, fill) => {
    const at = `[${table.count}]`;
    return editProperty(objectRow(table.view.entry), table.kind.list, [
      {
        type: "insertItem",
        path: "",
        item: { index: null, key: null, class: table.kind.className },
      },
      ...setField(at, table.kind.nameField, { type: "string", value: name }),
      ...fill(at),
    ]);
  };
}

/**
 * Write fields of one of the list's entries as one edit, adding each field the entry leaves
 * unwritten. Null where the view does not edit.
 */
export function useEntryFields():
  | ((element: BinRow, fields: readonly (readonly [string, LeafValue])[]) => Promise<boolean>)
  | null {
  const editProperty = use(LeafEditContext)?.editProperty;
  const table = use(TableContext);
  if (editProperty === undefined || table === null) return null;

  return async (element, fields) => {
    const at = itemStep(element);
    if (at === null) return false;
    if (fields.length === 0) return true;

    return editProperty(
      objectRow(table.view.entry),
      table.kind.list,
      fields.flatMap(([field, value]) => setField(at, field, value)),
    );
  };
}

/** Write one field of one of the list's entries. Null where the view does not edit. */
export function useEntryWrite():
  | ((element: BinRow, field: string, value: LeafValue) => Promise<boolean>)
  | null {
  const writeFields = useEntryFields();
  if (writeFields === null) return null;

  return (element, field, value) => writeFields(element, [[field, value]]);
}

/** Take one of the list's entries out, through the list as every other table edit goes. */
export function useEntryRemove(): ((element: BinRow) => Promise<boolean>) | null {
  const editProperty = use(LeafEditContext)?.editProperty;
  const table = use(TableContext);
  if (editProperty === undefined || table === null) return null;

  return async (element) => {
    const at = itemStep(element);
    if (at === null) return false;

    return editProperty(objectRow(table.view.entry), table.kind.list, [
      { type: "removeItem", path: at },
    ]);
  };
}
