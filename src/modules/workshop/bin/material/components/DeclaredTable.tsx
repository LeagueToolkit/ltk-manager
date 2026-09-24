import { DataTable, DataTableCells, type DataTableColumn, DataTableHeaders } from "@/components";
import { m } from "@/i18n";

import {
  elementsOf,
  fieldsOf,
  None,
  textOf,
  type WidgetProps,
} from "../../classes/components/ClassCells";
import { childCount, rowKey } from "../../tree/utils/binRows";
import { type ListKind, TableContext, type TableState } from "../state/declaredTable";
import { type DeclaredRow, declaredRows } from "../utils/declaredRows";
import { DeclaredRowFrame, frameKey } from "./DeclaredRow";

const NO_WARNINGS: ReadonlyMap<string, string> = new Map();

/**
 * One list as a table of the shader's declarations and the material's entries.
 *
 * "The shader declares the rows" in docs/ux/BIN_EDITOR.md.
 */
export function DeclaredTable<D extends { readonly name: string }>({
  section,
  pages,
  view,
  kind,
  declarations,
  columns,
  warnings = NO_WARNINGS,
}: WidgetProps & {
  kind: ListKind;
  declarations: readonly D[] | null;
  columns: DataTableColumn<DeclaredRow<D>>[];
  warnings?: ReadonlyMap<string, string>;
}) {
  const rows = declaredRows(
    elementsOf(section.rows, pages),
    (element) => textOf(fieldsOf(pages.get(rowKey(element)))(kind.nameField)),
    declarations,
  );
  const list = section.rows[0];
  const state: TableState = {
    pages,
    view,
    kind,
    count: list === undefined ? 0 : childCount(list),
    known: declarations !== null,
    warnings,
  };

  return (
    <TableContext value={state}>
      <DataTable
        ariaLabel={m.workshop_bin_row_fields_action()}
        options={{ data: rows, columns, getRowId: (row) => row.key, enableSorting: false }}
      >
        {(table) => (
          <div className="flex flex-col">
            <div className="flex gap-2 px-1.5 pb-0.5 text-meta text-surface-400">
              <DataTableHeaders headers={table.getFlatHeaders()} customCells />
            </div>
            {rows.length === 0 && <None />}
            {table.getRowModel().rows.map((row) => (
              <DeclaredRowFrame key={frameKey(row.original)} row={row.original}>
                <DataTableCells row={row} customCells />
              </DeclaredRowFrame>
            ))}
          </div>
        )}
      </DataTable>
    </TableContext>
  );
}
