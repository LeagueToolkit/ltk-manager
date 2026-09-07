import { type ReactNode, useMemo } from "react";
import { twMerge } from "tailwind-merge";

import type { BinRow } from "@/lib/tauri";

import { nameHash } from "./binHash";
import { RowValue, ValueMarkCell } from "./BinRow";
import { rowKey } from "./binRows";
import {
  Cell,
  childOf,
  elementsOf,
  fieldsOf,
  type LayoutPages,
  TableRows,
  TextCell,
  TextureTile,
  type WidgetProps,
} from "./ClassCells";
import { useValueMark, useValueMarks, ValueMarksContext } from "./useValueMarks";

/** One column of the emitter table: the field it draws, how wide, and in what cell. */
interface Column {
  /** The emitter's own field, which is what the header carries and what the cell holds. */
  readonly field: string;
  readonly width: string;
  readonly draw: (row: BinRow | undefined, pages: LayoutPages) => ReactNode;
}

/** The link under the custom material, which is the object that column draws. */
const MATERIAL = nameHash("Material");

/**
 * What each emitter draws, in the order a reader scans them.
 *
 * The header carries the field's own name rather than a word of its own, because a
 * column is one property of the emitter and the tree names it the same way.
 */
const COLUMNS: readonly Column[] = [
  {
    field: "emitterName",
    width: "w-48",
    draw: (row) => <TextCell row={row} className="text-surface-200" />,
  },
  { field: "disabled", width: "w-16", draw: (row) => <Plain row={row} /> },
  { field: "lifetime", width: "w-28", draw: (row) => <Plain row={row} /> },
  { field: "period", width: "w-28", draw: (row) => <Plain row={row} /> },
  { field: "rate", width: "w-32", draw: (row) => <Mark row={row} /> },
  { field: "particleLifetime", width: "w-32", draw: (row) => <Mark row={row} /> },
  { field: "birthColor", width: "w-28", draw: (row) => <Mark row={row} /> },
  { field: "Color", width: "w-28", draw: (row) => <Mark row={row} /> },
  {
    field: "texture",
    width: "w-64",
    draw: (row) => (
      <>
        <TextureTile row={row} size="row" />
        <TextCell row={row} className="min-w-0 flex-1 text-surface-300" />
      </>
    ),
  },
  { field: "blendMode", width: "w-24", draw: (row) => <Plain row={row} /> },
  { field: "SpawnShape", width: "w-40", draw: (row) => <Plain row={row} /> },
  { field: "primitive", width: "w-44", draw: (row) => <Plain row={row} /> },
  {
    field: "CustomMaterial",
    width: "w-56",
    draw: (row, pages) => <Plain row={childOf(pages, row, MATERIAL)} />,
  },
];

/** Each column with the hash its field is addressed by, hashed once at load. */
const ADDRESSED = COLUMNS.map((column) => ({ ...column, hash: nameHash(column.field) }));

/**
 * A row per emitter of both lists, with a column per field a VFX modder reads.
 *
 * The columns run wider than the pane, so the table scrolls sideways under its own
 * header rather than pushing the sections beside it. The marks are the columns' own,
 * because an emitter holds far more value families than the four this draws.
 */
export function EmitterTable({ section, pages, view }: WidgetProps) {
  const emitters = elementsOf(section.rows, pages);
  const drawn = useMemo(
    () =>
      emitters.flatMap((emitter) => {
        const fields = fieldsOf(pages.get(rowKey(emitter)));
        return ADDRESSED.map((column) => fields(column.hash)).filter(
          (row): row is BinRow => row !== undefined,
        );
      }),
    [emitters, pages],
  );
  const marks = useValueMarks(view.document, drawn);

  return (
    <ValueMarksContext value={marks}>
      <div className="overflow-x-auto scrollbar-md">
        <div className="min-w-max">
          <div className="flex gap-2 px-1.5 pb-0.5 text-meta text-surface-400">
            {ADDRESSED.map((column) => (
              <span key={column.field} className={twMerge("shrink-0 truncate", column.width)}>
                {column.field}
              </span>
            ))}
          </div>
          <TableRows rows={emitters}>
            {(emitter) => {
              const fields = fieldsOf(pages.get(rowKey(emitter)));
              return ADDRESSED.map((column) => (
                <span
                  key={column.field}
                  className={twMerge(
                    "flex shrink-0 items-center gap-2 overflow-hidden",
                    column.width,
                  )}
                >
                  {column.draw(fields(column.hash), pages)}
                </span>
              ));
            }}
          </TableRows>
        </div>
      </div>
    </ValueMarksContext>
  );
}

/** A field in the cell its own row draws, which is every column with no widget of its own. */
function Plain({ row }: { row: BinRow | undefined }) {
  if (row === undefined) return null;
  return (
    <Cell row={row} className="flex min-w-0 items-center gap-2">
      <RowValue row={row} />
    </Cell>
  );
}

/** A value family's constant alone, without the class its row would name beside it. */
function Mark({ row }: { row: BinRow | undefined }) {
  const mark = useValueMark(row === undefined ? undefined : rowKey(row));
  if (row === undefined) return null;
  return (
    <Cell row={row} className="flex min-w-0 items-center gap-2">
      <ValueMarkCell mark={mark} />
    </Cell>
  );
}
