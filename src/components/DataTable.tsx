import {
  type Column,
  type ColumnDef,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type RowData,
  type SortingState,
  type TableMeta,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";

import { HintIcon } from "./HintIcon";
import { Table } from "./Table";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Extra classes for this column's header cell. */
    headerClassName?: string;
    /** Extra classes for this column's body cells. */
    cellClassName?: string;
  }
}

export interface DataTableProps<TData> {
  // react-table types its own `columns` option this way; the value type varies
  // per column, so a single generic can't capture it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  getRowId?: (row: TData) => string;
  meta?: TableMeta<TData>;
  /** Controlled global-filter value (e.g. a search box the parent owns). */
  globalFilter?: string;
  globalFilterFn?: FilterFn<TData>;
  initialSorting?: SortingState;
  /** Shown in place of the body when there are no rows to render. */
  emptyState?: ReactNode;
  className?: string;
  /** Applied to the scroll container — use for a max-height, e.g. `max-h-112`. */
  scrollClassName?: string;
}

/**
 * Headless-table renderer wired to the app's `Table` primitives: it owns the
 * `useReactTable` instance, core/sorted/filtered row models, a sticky header,
 * and per-column class hooks (`columnDef.meta.headerClassName`/`cellClassName`).
 * Callers supply only columns, data, and options.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  meta,
  globalFilter,
  globalFilterFn,
  initialSorting = [],
  emptyState,
  className,
  scrollClassName,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    globalFilterFn,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    meta,
  });

  const rows = table.getRowModel().rows;

  return (
    <div
      className={twMerge(
        "overflow-hidden rounded-xl border border-surface-700 bg-surface-800/40",
        className,
      )}
    >
      <div className={twMerge("overflow-auto", scrollClassName)}>
        <Table.Root>
          <Table.Header>
            {table.getHeaderGroups().map((headerGroup) => (
              <Table.Row key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <Table.Head
                    key={header.id}
                    className={twMerge(
                      "sticky top-0 z-10",
                      header.column.columnDef.meta?.headerClassName,
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </Table.Head>
                ))}
              </Table.Row>
            ))}
          </Table.Header>
          <Table.Body>
            {rows.map((row, index) => (
              <Table.Row key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <Table.Cell
                    key={cell.id}
                    className={twMerge(
                      index === rows.length - 1 && "border-b-0",
                      cell.column.columnDef.meta?.cellClassName,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </div>

      {rows.length === 0 && emptyState}
    </div>
  );
}

export interface DataTableColumnHeaderProps<TData, TValue> {
  column: Column<TData, TValue>;
  /** Optional explanatory hint shown as a `HintIcon` beside the label. */
  hint?: ReactNode;
  children: ReactNode;
}

/**
 * Header-cell content for a `DataTable` column: a click-to-sort button (when the
 * column is sortable) with an optional hint icon beside it. The icon sits
 * outside the button so the two stay separate interactive controls.
 */
export function DataTableColumnHeader<TData, TValue>({
  column,
  hint,
  children,
}: DataTableColumnHeaderProps<TData, TValue>) {
  return (
    <div className="flex items-center gap-1">
      {column.getCanSort() && (
        <Table.SortButton direction={column.getIsSorted()} onClick={() => column.toggleSorting()}>
          {children}
        </Table.SortButton>
      )}
      {!column.getCanSort() && children}
      {hint && <HintIcon content={hint} />}
    </div>
  );
}
