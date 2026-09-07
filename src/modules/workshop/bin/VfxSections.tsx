import { CaretRightIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { SegmentedControl } from "@/components";
import { useHorizontalWheel } from "@/hooks";
import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";

import { CHECKERBOARD } from "../preview/ImagePreview";
import { nameHash } from "./binHash";
import { RowValue } from "./BinRow";
import { fieldHash, rowKey } from "./binRows";
import {
  Cell,
  childOf,
  elementsOf,
  EmptyTile,
  FieldRow,
  fieldsIn,
  type FieldsOf,
  fieldsOf,
  type LayoutPages,
  None,
  TableRows,
  TextCell,
  texturePath,
  TextureTile,
  ValueCell,
  type WidgetProps,
} from "./ClassCells";
import type { PlacedSection } from "./classLayouts";
import { CARD, type EmitterGroup, GROUP_TITLE, type GroupedRows, groupRows } from "./emitterGroups";
import { useValueMark, useValueMarks, ValueMarksContext } from "./useValueMarks";
import { channels, colorCss, type ColorStop, gradientCss } from "./valueRows";

/** The second list, whose cards are marked, since one strip holds both. */
const SIMPLE_LIST = nameHash("simpleEmitterDefinitionData");

/** The room a card takes, which is what fits a name and a square side by side in a pane. */
const CARD_WIDTH = "w-40";

/** The room the panel's name column takes, which the longest emitter field fits in. */
const PANEL_NAME = "w-56";

/** The panel scrolls past this, so a group of thirty fields owns no more of the page. */
const PANEL_HEIGHT = "max-h-72";

/**
 * The Emitters section, as a strip of cards or as the table of columns.
 *
 * "The emitter strip" in docs/ux/BIN_EDITOR.md.
 */
export function Emitters({ section, pages, view }: WidgetProps) {
  const [mode, setMode] = useState<"cards" | "table">("cards");

  return (
    <div className="flex flex-col gap-1.5">
      <SegmentedControl
        size="xs"
        className="self-end font-sans"
        aria-label={m.workshop_bin_emitter_view_label()}
        value={mode}
        onChange={setMode}
        options={[
          { value: "cards", label: m.workshop_bin_emitter_view_cards_label() },
          { value: "table", label: m.workshop_bin_emitter_view_table_label() },
        ]}
      />
      {mode === "cards" && <EmitterStrip section={section} pages={pages} view={view} />}
      {mode === "table" && <EmitterTable section={section} pages={pages} view={view} />}
    </div>
  );
}

/** One emitter of one of the two lists, with the groups its own fields fall into. */
interface EmitterCardData {
  readonly row: BinRow;
  readonly key: string;
  /** Its place in its own list, which is the index the wire path addresses it by. */
  readonly index: number;
  readonly simple: boolean;
  readonly fields: FieldsOf;
  readonly groups: readonly GroupedRows[];
}

/** Which card is open, and at which of its groups. */
interface Chosen {
  readonly key: string;
  readonly group: EmitterGroup;
}

function cardsOf(section: PlacedSection, pages: LayoutPages): EmitterCardData[] {
  return section.rows.flatMap((container) => {
    const simple = fieldHash(container.path) === SIMPLE_LIST;
    const elements = pages.get(rowKey(container))?.rows ?? [];
    return elements.map((row, index) => {
      const fields = pages.get(rowKey(row))?.rows ?? [];
      return {
        row,
        key: rowKey(row),
        index,
        simple,
        fields: fieldsIn(fields),
        groups: groupRows(fields),
      };
    });
  });
}

/** Every emitter as a card, and the chosen card's chosen group under them. */
function EmitterStrip({ section, pages, view }: WidgetProps) {
  const strip = useRef<HTMLDivElement>(null);
  useHorizontalWheel(strip);
  const cards = useMemo(() => cardsOf(section, pages), [section, pages]);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const open = openOf(chosen, cards);
  const card = cards.find((each) => each.key === open?.key);
  const group = card?.groups.find((each) => each.group === open?.group);

  const drawn = useMemo(
    () => [
      ...cards.flatMap((each) => {
        const colour = each.fields(CARD.colour);
        return colour === undefined ? [] : [colour];
      }),
      ...(group?.rows ?? []),
    ],
    [cards, group],
  );
  const marks = useValueMarks(view.document, drawn);

  if (cards.length === 0) return <None />;
  return (
    <ValueMarksContext value={marks}>
      <div className="flex flex-col gap-1.5">
        <div ref={strip} className="overflow-x-auto scrollbar-sm">
          <div className="flex items-start gap-1.5 pb-1">
            {cards.map((each) => (
              <EmitterCard
                key={each.key}
                card={each}
                open={open?.key === each.key ? open.group : null}
                onChoose={setChosen}
              />
            ))}
          </div>
        </div>
        <EmitterPanel card={card} group={group} />
      </div>
    </ValueMarksContext>
  );
}

/** The chosen card and group, falling back to the first emitter's first group. */
function openOf(chosen: Chosen | null, cards: readonly EmitterCardData[]): Chosen | null {
  if (chosen !== null && cards.some((each) => each.key === chosen.key)) return chosen;
  const [first] = cards;
  const group = first?.groups[0];
  if (first === undefined || group === undefined) return null;
  return { key: first.key, group: group.group };
}

/** A card: what the emitter is called, what it looks like, and what it sets. */
function EmitterCard({
  card,
  open,
  onChoose,
}: {
  card: EmitterCardData;
  open: EmitterGroup | null;
  onChoose: (chosen: Chosen) => void;
}) {
  const name = card.fields(CARD.name);
  const disabled = card.fields(CARD.disabled);
  const off = disabled?.value.type === "bool" && disabled.value.value;

  return (
    <div
      data-ui="EmitterCard"
      data-row-key={card.key}
      /* DS-RADIUS, DS-HOVER, DS-VEIL */
      className={twMerge(
        "flex shrink-0 flex-col gap-1 rounded-lg border p-1.5",
        CARD_WIDTH,
        open === null
          ? "border-surface-veil-strong bg-surface-900 hover:border-accent-hover"
          : "border-accent-500/60 bg-surface-800",
        off && "opacity-60",
      )}
    >
      <span className="flex items-center gap-1">
        {off && (
          <EyeSlashIcon
            weight="bold"
            role="img"
            aria-label={m.workshop_bin_emitter_disabled_label()}
            className="h-3.5 w-3.5 shrink-0 text-surface-400"
            data-row-key={disabled === undefined ? undefined : rowKey(disabled)}
          />
        )}
        <Cell row={name} className="min-w-0 flex-1 truncate font-medium text-surface-200">
          {nameOf(card)}
        </Cell>
        <span className="shrink-0 text-meta text-surface-500">[{card.index}]</span>
      </span>
      <CardSquare card={card} />
      {card.simple && (
        <span className="text-meta text-surface-500">{m.workshop_bin_emitter_simple_label()}</span>
      )}
      {/* DS-GROUND, DS-RADIUS */}
      <span className="flex flex-col rounded-sm bg-surface-950/40 p-0.5">
        {card.groups.map((each) => (
          <button
            key={each.group}
            type="button"
            /* DS-RADIUS, DS-VEIL */
            className={twMerge(
              "cursor-pointer truncate rounded-sm px-1 py-px text-left",
              open === each.group
                ? "bg-accent-500/15 text-accent-300"
                : "text-surface-400 hover:bg-surface-veil hover:text-surface-200",
            )}
            onClick={() => onChoose({ key: card.key, group: each.group })}
          >
            {GROUP_TITLE[each.group]()}
          </button>
        ))}
      </span>
    </div>
  );
}

/** The emitter's texture, the colour it births with where it has none, else the tile. */
function CardSquare({ card }: { card: EmitterCardData }) {
  const texture = card.fields(CARD.texture);
  const colour = card.fields(CARD.colour);
  const mark = useValueMark(colour === undefined ? undefined : rowKey(colour));
  const rgba = mark?.family === "color" && mark.constant !== null ? channels(mark.constant) : null;

  if (texturePath(texture) !== null) return <TextureTile row={texture} size="card" />;
  if (colour !== undefined && rgba !== null) {
    return <ColourSquare row={colour} rgba={rgba} stops={mark?.stops ?? []} />;
  }
  return <EmptyTile size="card" />;
}

/** A `ValueColor` over the whole square, its stops as the band they draw on a row. */
function ColourSquare({
  row,
  rgba,
  stops,
}: {
  row: BinRow;
  rgba: ColorStop["rgba"];
  stops: readonly ColorStop[];
}) {
  return (
    <Cell
      row={row}
      /* DS-TOKEN, DS-VEIL, DS-RADIUS */
      className={`block aspect-square w-full overflow-hidden rounded-sm border border-surface-veil-strong ${CHECKERBOARD} [background-size:8px_8px]`}
    >
      <span
        role="img"
        aria-label={m.workshop_bin_emitter_colour_label()}
        className="block h-full w-full"
        style={{ background: stops.length > 0 ? gradientCss(stops) : colorCss(rgba) }}
      />
    </Cell>
  );
}

/** The open group's fields, each on a line of its own. */
function EmitterPanel({
  card,
  group,
}: {
  card: EmitterCardData | undefined;
  group: GroupedRows | undefined;
}) {
  return (
    /* DS-RADIUS, DS-SCROLLBAR */
    <div
      className={twMerge(
        "flex flex-col gap-0.5 overflow-y-auto rounded-md border border-surface-700/50 p-1.5 scrollbar-md",
        PANEL_HEIGHT,
      )}
    >
      {card !== undefined && group !== undefined && (
        <>
          <span className="flex items-center gap-1 px-1.5 text-meta text-surface-400">
            <span className="min-w-0 truncate text-surface-200">{nameOf(card)}</span>
            <span className="shrink-0 text-surface-500">[{card.index}]</span>
            <CaretRightIcon weight="bold" className="h-3 w-3 shrink-0" />
            <span>{GROUP_TITLE[group.group]()}</span>
          </span>
          {group.rows.map((row) => (
            <FieldRow key={rowKey(row)} row={row} width={PANEL_NAME} />
          ))}
        </>
      )}
    </div>
  );
}

function nameOf(card: EmitterCardData): string {
  const name = card.fields(CARD.name);
  return name?.value.type === "string" ? name.value.value : card.row.name;
}

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
  const scroller = useRef<HTMLDivElement>(null);
  useHorizontalWheel(scroller);
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
      <div ref={scroller} className="overflow-x-auto scrollbar-md">
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
  if (row === undefined) return null;
  return (
    <Cell row={row} className="flex min-w-0 items-center gap-2">
      <ValueCell row={row} />
    </Cell>
  );
}
