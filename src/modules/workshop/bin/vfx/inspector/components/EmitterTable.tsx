import { type ReactNode, useMemo, useRef } from "react";

import { useHorizontalWheel } from "@/hooks";
import type { BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import {
  Cell,
  childOf,
  elementsOf,
  fieldsOf,
  type LayoutPages,
  TableRows,
  TextCell,
  TextureTile,
  ValueCell,
  type WidgetProps,
} from "../../../classes/components/ClassCells";
import { FieldCard, schemaDeclared } from "../../../classes/components/FieldCard";
import { useClassSchema } from "../../../classes/hooks/useClassSchema";
import { nameHash } from "../../../shared/utils/binHash";
import { RowValue } from "../../../tree/components/BinRow";
import { rowKey } from "../../../tree/utils/binRows";
import { useValueMarks, ValueMarksContext } from "../../../values/hooks/useValueMarks";
import { useEmitters } from "../state/emitterChoice";
import { emitterLabel } from "../utils/emitterLabels";

/** One column of the emitter table: the field it draws, how wide, and in what cell. */
interface Column {
  /** The emitter's own field, which is what the header carries and what the cell holds. */
  readonly field: string;
  readonly width: string;
  readonly draw: (row: BinRow | undefined, pages: LayoutPages) => ReactNode;
}

/** The class of every emitter in the table, which declares the fields its columns show. */
const EMITTER = nameHash("VfxEmitterDefinitionData");

/** The link under the custom material, which is the object that column draws. */
const MATERIAL = nameHash("Material");

/** Emitter columns in authoring order. */
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
  const scroller = useRef<HTMLDivElement>(null);
  useHorizontalWheel(scroller);
  const { cards } = useEmitters();

  /* The strip already filtered, so the table takes what it left rather than matching
     names a second time and drifting from it. */
  const shown = useMemo(() => new Set(cards.map((card) => card.key)), [cards]);
  const emitters = elementsOf(section.rows, pages).filter((row) => shown.has(rowKey(row)));
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
      <div ref={scroller} className="overflow-x-auto scrollbar-md">
        <div className="min-w-max">
          <TableRows
            rows={emitters}
            showHeader
            columns={ADDRESSED.map((column) => ({
              id: column.field,
              header: () => (
                <ColumnHeader
                  field={column.field}
                  hash={column.hash}
                  className={twMerge("shrink-0 font-sans", column.width)}
                />
              ),
              cell: ({ row }) => {
                const fields = fieldsOf(pages.get(row.id));
                return (
                  <span
                    className={twMerge(
                      "flex shrink-0 items-center gap-2 overflow-hidden",
                      column.width,
                    )}
                  >
                    {column.draw(fields(column.hash), pages)}
                  </span>
                );
              },
            }))}
          />
        </div>
      </div>
    </ValueMarksContext>
  );
}

interface ColumnHeaderProps {
  field: string;
  hash: string;
  className: string;
}

/** A column header that opens the field card for the column's emitter field. */
function ColumnHeader({ field, hash, className }: ColumnHeaderProps) {
  const { data: schema } = useClassSchema(EMITTER);

  return (
    <FieldCard
      classHash={EMITTER}
      fieldHash={hash}
      name={field}
      label={emitterLabel(hash, field)}
      unnamed={false}
      declared={schemaDeclared(schema, hash)}
      triggerClassName={className}
    />
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
  if (row === undefined) return null;
  return (
    <Cell row={row} className="flex min-w-0 items-center gap-2">
      <ValueCell row={row} />
    </Cell>
  );
}
