import { type CSSProperties, use, useMemo } from "react";

import {
  DataTable,
  DataTableCells,
  type DataTableColumn,
  DataTableHeaders,
  Table,
} from "@/components";
import { m } from "@/i18n";

import {
  elementsOf,
  fieldsOf,
  None,
  textOf,
  type WidgetProps,
} from "../../classes/components/ClassCells";
import { LeafEditContext } from "../../tree/hooks/useLeafEdit";
import { childCount, rowKey } from "../../tree/utils/binRows";
import { type ListKind, TableContext, type TableState } from "../state/declaredTable";
import { type DeclaredRow, declaredRows } from "../utils/declaredRows";
import {
  actionsColumn,
  DeclaredRowFrame,
  frameKey,
  nameColumn,
  nameWidth,
  TABLE_CLASS,
} from "./DeclaredRow";

const NO_WARNINGS: ReadonlyMap<string, string> = new Map();

/**
 * One list as a table of the shader's declarations and the material's entries.
 *
 * "The shader declares the rows" in docs/ux/BIN_EDITOR.md. The table sizes its columns to
 * what they hold, and a pane too narrow for it scrolls it sideways.
 */
export function DeclaredTable<D extends { readonly name: string }>({
  section,
  pages,
  view,
  kind,
  declarations,
  names,
  columns,
  warnings = NO_WARNINGS,
}: WidgetProps & {
  kind: ListKind;
  declarations: readonly D[] | null;
  /** The names every table of the material lists, which one name column is measured over. */
  names: readonly string[];
  /** The columns between the name and the actions. */
  columns: DataTableColumn<DeclaredRow<D>>[];
  warnings?: ReadonlyMap<string, string>;
}) {
  const editable = use(LeafEditContext) !== null;
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

  const all = useMemo(
    () => [nameColumn<D>(), ...columns, ...(editable ? [actionsColumn<D>()] : [])],
    [editable, columns],
  );
  const width = {
    "--name-width": nameWidth([...names, ...rows.map((row) => row.name)]),
  } as CSSProperties;

  if (rows.length === 0) return <None />;

  return (
    <TableContext value={state}>
      {/* DS-SCROLLBAR */}
      <div className="@container overflow-x-auto scrollbar-sm" style={width}>
        <DataTable
          ariaLabel={m.workshop_bin_row_fields_action()}
          options={{ data: rows, columns: all, getRowId: (row) => row.key, enableSorting: false }}
        >
          {(table) => (
            <Table.Root aria-label={m.workshop_bin_row_fields_action()} className={TABLE_CLASS}>
              <Table.Header className="text-surface-400 select-none">
                <Table.Row>
                  <DataTableHeaders headers={table.getFlatHeaders()} customCells />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {table.getRowModel().rows.map((row) => (
                  <DeclaredRowFrame key={frameKey(row.original)} row={row.original}>
                    <DataTableCells row={row} customCells />
                  </DeclaredRowFrame>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </DataTable>
      </div>
    </TableContext>
  );
}
