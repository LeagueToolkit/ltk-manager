import type { CSSProperties } from "react";

import { DataTable, type DataTableColumn } from "@/components";
import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { Cell, elementsOf, None, type WidgetProps } from "../../classes/components/ClassCells";
import { RowValue } from "../../tree/components/BinRow";
import { rowKey } from "../../tree/utils/binRows";
import { useDeclaredNames } from "../hooks/useShaderSchema";
import { DeclaredCell, Heading, nameWidth, ROW_CLASS, TABLE_CLASS } from "./DeclaredRow";
import { VALUE_WIDTH } from "./MaterialCells";

const MACRO_NAME = "block w-(--name-width) truncate select-text";

/* The column that takes the room the others spare. */
const FILL = "w-full";

/* A macro is a map entry, whose row is named by its key and holds its value itself. */
const MACRO_COLUMNS: DataTableColumn<BinRow>[] = [
  {
    id: "name",
    header: () => (
      <Heading>
        <span className={MACRO_NAME}>{m.workshop_bin_material_name_label()}</span>
      </Heading>
    ),
    cell: ({ row }) => {
      const name = unquoted(row.original.name);
      return (
        <DeclaredCell>
          <span className={MACRO_NAME} title={name}>
            {name}
          </span>
        </DeclaredCell>
      );
    },
  },
  {
    id: "value",
    header: () => <Heading className={FILL}>{m.workshop_bin_material_value_label()}</Heading>,
    cell: ({ row }) => (
      <DeclaredCell className={FILL}>
        <Cell row={row.original} className={VALUE_WIDTH}>
          <RowValue row={row.original} />
        </Cell>
      </DeclaredCell>
    ),
  },
];

/** A macro's define, without the quotes the tree names a string key with. */
function unquoted(name: string): string {
  if (name.length < 2 || !name.startsWith('"') || !name.endsWith('"')) return name;
  return name.slice(1, -1);
}

/** `shaderMacros` as a table of define and value. */
export function MaterialMacros({ section, pages, view }: WidgetProps) {
  const rows = elementsOf(section.rows, pages);
  const names = useDeclaredNames(view);
  const width = {
    "--name-width": nameWidth([...names, ...rows.map((row) => unquoted(row.name))]),
  } as CSSProperties;

  if (rows.length === 0) return <None />;

  return (
    /* DS-SCROLLBAR */
    <div className="@container overflow-x-auto scrollbar-sm" style={width}>
      <DataTable
        ariaLabel={m.workshop_bin_row_fields_action()}
        options={{ data: rows, columns: MACRO_COLUMNS, getRowId: rowKey, enableSorting: false }}
        className={TABLE_CLASS}
        headerClassName="text-surface-400 select-none"
        rowProps={() => ({ className: ROW_CLASS })}
        customCells
        customHeaders
      />
    </div>
  );
}
