import { CaretDownIcon, CaretRightIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Menu, SegmentedControl } from "@/components";
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
import type { LayoutFrame, PlacedSection } from "./classLayouts";
import { CurveChainContext } from "./curveTarget";
import { CARD, type EmitterGroup, GROUP_TITLE, type GroupedRows, groupRows } from "./emitterGroups";
import { useValueMark, useValueMarks, ValueMarksContext } from "./useValueMarks";
import {
  channels,
  colorCss,
  type ColorStop,
  colorStops,
  type CurveRead,
  gradientCss,
} from "./valueRows";

/** The second list, whose cards are marked, since one strip holds both. */
const SIMPLE_LIST = nameHash("simpleEmitterDefinitionData");

/** The room a card takes, which is what fits a name and a square side by side in a pane. */
const CARD_WIDTH = "w-40";

/** The room the panel's name column takes, which the longest emitter field fits in. */
const PANEL_NAME = "w-56";

/** The same column in a shell, narrowed to what a vector’s three components leave it. */
export const INSPECTOR_NAME = "w-48";

/** The panel scrolls past this, so a group of thirty fields owns no more of the page. */
const PANEL_HEIGHT = "max-h-72";

/** Which of the two readings of the emitter lists is drawn. */
export type EmitterMode = "cards" | "table";

/** What the inspector draws, which is the crumb segment last aimed at. */
export type InspectorTarget = "system" | "emitter" | "group";

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

/**
 * The reading, the open card, and the rows the strip marks.
 *
 * The frame holds it rather than the section, because a stack draws the panel under the
 * strip and a shell draws it in the column beside, so a fall from one to the other
 * remounts the section and would lose the reader's place with it.
 */
export interface EmitterChoice {
  readonly cards: readonly EmitterCardData[];
  readonly card: EmitterCardData | undefined;
  readonly group: GroupedRows | undefined;
  readonly open: Chosen | null;
  readonly target: InspectorTarget;
  /** The groups the inspector draws: every one the card sets, or the open one alone. */
  readonly shown: readonly GroupedRows[];
  /** Draw one of the crumb segments, which is what clicking that segment does. */
  readonly aim: (target: InspectorTarget) => void;
  /** Open a card, which its name row does and which aims the crumb middle segment. */
  readonly chooseCard: (key: string) => void;
  /** Open one group of a card, which a chip does and which aims the last segment. */
  readonly chooseGroup: (chosen: Chosen) => void;
  readonly mode: EmitterMode;
  readonly setMode: (mode: EmitterMode) => void;
  /** The squares colours and the rows the inspector draws, the only families it marks. */
  readonly marked: readonly BinRow[];
  /** What those rows are read for, which is a sparkline only where one group draws. */
  readonly read: CurveRead;
}

const NO_CARDS: readonly EmitterCardData[] = [];
const NO_GROUPS: readonly GroupedRows[] = [];
const NO_MARKED: readonly BinRow[] = [];

const NO_EMITTERS: EmitterChoice = {
  cards: NO_CARDS,
  card: undefined,
  group: undefined,
  open: null,
  target: "group",
  shown: NO_GROUPS,
  aim: () => {},
  chooseCard: () => {},
  chooseGroup: () => {},
  mode: "cards",
  setMode: () => {},
  marked: NO_MARKED,
  read: "bands",
};

/** What the frame chose, which both halves of the section read wherever it drew them. */
export const EmitterChoiceContext = createContext<EmitterChoice>(NO_EMITTERS);

/** What the frame chose, for the half of the section reading it. */
export function useEmitters(): EmitterChoice {
  return use(EmitterChoiceContext);
}

/** The section's own state, for the frame to hold above the two ways it draws it. */
export function useEmitterChoice(
  placed: readonly PlacedSection[],
  pages: LayoutPages,
  frame: LayoutFrame,
): EmitterChoice {
  const cards = useMemo(() => {
    const section = placed.find((each) => each.widget === "emitters");
    return section === undefined ? NO_CARDS : cardsOf(section, pages);
  }, [placed, pages]);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [target, setTarget] = useState<InspectorTarget>("group");
  const [mode, setMode] = useState<EmitterMode>("cards");

  const open = useMemo(() => openOf(chosen, cards), [chosen, cards]);
  const card = cards.find((each) => each.key === open?.key);
  const group = card?.groups.find((each) => each.group === open?.group);

  const chooseGroup = useCallback((next: Chosen) => {
    setChosen(next);
    setTarget("group");
  }, []);
  const chooseCard = useCallback(
    (key: string) => {
      const first = cards.find((each) => each.key === key)?.groups[0];
      if (first === undefined) return;
      setChosen({ key, group: first.group });
      setTarget("emitter");
    },
    [cards],
  );

  /* A stack draws the panel under the strip, so its table takes the panel's place. A
     shell draws it in the column beside, where a table takes neither. */
  const drawn = frame === "shell" || mode === "cards";
  const shown = useMemo(
    () => (drawn ? shownGroups(target, card, group) : NO_GROUPS),
    [drawn, target, card, group],
  );
  const marked = useMemo(
    () => [
      ...cards.flatMap((each) => {
        const colour = each.fields(CARD.colour);
        return colour === undefined ? [] : [colour];
      }),
      ...shown.flatMap((each) => each.rows),
    ],
    [cards, shown],
  );

  /* One group is the eight-odd rows two more read levels are bounded for. Every group of
     an emitter is a hundred and forty, which is the scan the mark alone answers. */
  const read: CurveRead = drawn && target === "group" ? "sparklines" : "bands";

  return useMemo(
    () => ({
      cards,
      card,
      group,
      open,
      target,
      shown,
      aim: setTarget,
      chooseCard,
      chooseGroup,
      mode,
      setMode,
      marked,
      read,
    }),
    [cards, card, group, open, target, shown, chooseCard, chooseGroup, mode, marked, read],
  );
}

/** The groups one target draws, which is what the inspector holds and what it marks. */
function shownGroups(
  target: InspectorTarget,
  card: EmitterCardData | undefined,
  group: GroupedRows | undefined,
): readonly GroupedRows[] {
  if (target === "system" || card === undefined) return NO_GROUPS;
  if (target === "emitter") return card.groups;
  return group === undefined ? NO_GROUPS : [group];
}

/**
 * The Emitters section, as a strip of cards or as the table of columns.
 *
 * "The emitter strip" in docs/ux/BIN_EDITOR.md. A stack draws the panel under the strip.
 * A shell draws it in the inspector column, so this half stops at the strip.
 */
export function Emitters({ section, pages, view }: WidgetProps) {
  const { mode } = useEmitters();

  return (
    <div className="flex flex-col gap-1.5">
      <EmitterModes />
      {mode === "cards" && (
        <div className="flex flex-col gap-1.5">
          <EmitterStrip />
          {view.frame === "stack" && <EmitterPanel className={PANEL_HEIGHT} />}
        </div>
      )}
      {mode === "table" && <EmitterTable section={section} pages={pages} view={view} />}
    </div>
  );
}

/** The control that picks the reading, which either frame draws over the strip. */
function EmitterModes() {
  const { mode, setMode } = useEmitters();

  return (
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
  );
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

/** Every emitter as a card, in the one strip that scrolls sideways. */
function EmitterStrip() {
  const { cards, open } = useEmitters();
  const strip = useRef<HTMLDivElement>(null);
  useHorizontalWheel(strip);

  if (cards.length === 0) return <None />;
  return (
    <div ref={strip} className="overflow-x-auto scrollbar-sm">
      <div className="flex items-start gap-1.5 pb-1">
        {cards.map((each) => (
          <EmitterCard
            key={each.key}
            card={each}
            open={open?.key === each.key ? open.group : null}
          />
        ))}
      </div>
    </div>
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
function EmitterCard({ card, open }: { card: EmitterCardData; open: EmitterGroup | null }) {
  const { target, chooseCard, chooseGroup } = useEmitters();
  const name = card.fields(CARD.name);
  const disabled = card.fields(CARD.disabled);
  const off = disabled?.value.type === "bool" && disabled.value.value;

  return (
    <div
      data-ui="EmitterCard"
      data-row-key={card.key}
      /* DS-GROUND, DS-RADIUS, DS-HOVER, DS-VEIL */
      className={twMerge(
        "flex shrink-0 flex-col gap-1 rounded-lg border bg-surface-800 p-1.5",
        CARD_WIDTH,
        open === null
          ? "border-surface-veil-strong hover:border-accent-hover"
          : "border-accent-500/60 bg-surface-700",
        off && "opacity-60",
      )}
    >
      <button
        type="button"
        /* DS-RADIUS, DS-VEIL */
        className={twMerge(
          "flex cursor-pointer items-center gap-1 rounded-sm px-0.5 text-left hover:bg-surface-veil",
          open !== null && target === "emitter" && "bg-accent-500/15",
        )}
        onClick={() => chooseCard(card.key)}
      >
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
      </button>
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
              open === each.group && target === "group"
                ? "bg-accent-500/15 text-accent-300"
                : "text-surface-400 hover:bg-surface-veil hover:text-surface-200",
            )}
            onClick={() => chooseGroup({ key: card.key, group: each.group })}
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
  const stops = mark?.family === "color" ? colorStops(mark.keys) : [];
  const rgba = mark?.family === "color" ? channels(mark.constant) : null;
  const background = squareBackground(stops, rgba);

  if (texturePath(texture) !== null) return <TextureTile row={texture} size="card" />;
  if (colour !== undefined && background !== null) {
    return <ColourSquare row={colour} background={background} />;
  }
  return <EmptyTile size="card" />;
}

/** The square's paint: the stops where a colour animates, else its constant, else nothing. */
function squareBackground(
  stops: readonly ColorStop[],
  rgba: ColorStop["rgba"] | null,
): string | null {
  if (stops.length > 0) return gradientCss(stops);
  return rgba === null ? null : colorCss(rgba);
}

/** A `ValueColor` over the whole square, its stops as the band they draw on a row. */
function ColourSquare({ row, background }: { row: BinRow; background: string }) {
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
        style={{ background }}
      />
    </Cell>
  );
}

/**
 * The fields the inspector is aimed at, each on a line of its own.
 *
 * The host gives it its height and its name column: a stack caps the height so no group
 * owns the page, and a shell hands it the column and narrows the names to fit a vector.
 */
export function EmitterPanel({
  className,
  nameWidth = PANEL_NAME,
}: {
  className?: string;
  nameWidth?: string;
}) {
  const { card, shown } = useEmitters();

  return (
    /* DS-GROUND, DS-RADIUS, DS-SCROLLBAR */
    <div
      data-ui="EmitterPanel"
      className={twMerge(
        "flex flex-col gap-0.5 overflow-y-auto rounded-md border border-surface-700/50 bg-surface-900 p-1.5 scrollbar-md",
        className,
      )}
    >
      <CurveChainContext value={card === undefined ? "" : `${nameOf(card)} [${card.index}]`}>
        {shown.map((each) => (
          <div key={each.group} className="flex flex-col gap-0.5">
            {shown.length > 1 && (
              <span className="px-1.5 pt-1 font-sans text-xs font-medium tracking-wide text-surface-400 uppercase">
                {GROUP_TITLE[each.group]()}
              </span>
            )}
            {each.rows.map((row) => (
              <FieldRow key={rowKey(row)} row={row} width={nameWidth} />
            ))}
          </div>
        ))}
      </CurveChainContext>
    </div>
  );
}

/**
 * System, emitter and group, each a segment aiming the inspector at what it names.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md.
 */
export function ShellCrumb({ system }: { system: string }) {
  const { target, aim, card, group } = useEmitters();

  return (
    <nav
      data-ui="ShellCrumb"
      aria-label={m.workshop_bin_shell_crumb_label()}
      className="flex min-w-0 items-center gap-1 px-1 text-meta"
    >
      <CrumbSegment on={target === "system"} onClick={() => aim("system")}>
        {system}
      </CrumbSegment>
      {card !== undefined && (
        <>
          <CrumbCaret />
          <CrumbSegment on={target === "emitter"} onClick={() => aim("emitter")}>
            <span className="min-w-0 truncate">{nameOf(card)}</span>
            <span className="shrink-0 text-surface-500">[{card.index}]</span>
          </CrumbSegment>
          {group !== undefined && (
            <>
              <CrumbCaret />
              <GroupSegment card={card} group={group} on={target === "group"} />
            </>
          )}
        </>
      )}
    </nav>
  );
}

function CrumbCaret() {
  return <CaretRightIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-500" />;
}

function CrumbSegment({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      /* DS-RADIUS, DS-VEIL */
      className={twMerge(
        "flex min-w-0 cursor-pointer items-center gap-1 truncate rounded-sm px-1 py-0.5",
        on ? "bg-accent-500/15 text-accent-300" : "text-surface-400 hover:bg-surface-veil",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The last segment, which is a menu of the groups the emitter sets. */
function GroupSegment({
  card,
  group,
  on,
}: {
  card: EmitterCardData;
  group: GroupedRows;
  on: boolean;
}) {
  const { chooseGroup } = useEmitters();

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <button
            type="button"
            /* DS-RADIUS, DS-VEIL */
            className={twMerge(
              "flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5",
              on ? "bg-accent-500/15 text-accent-300" : "text-surface-400 hover:bg-surface-veil",
            )}
          >
            {GROUP_TITLE[group.group]()}
            <CaretDownIcon weight="bold" className="h-3 w-3 shrink-0" />
          </button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="start" sideOffset={4}>
          <Menu.Popup className="w-40">
            {card.groups.map((each) => (
              <Menu.Item
                key={each.group}
                onClick={() => chooseGroup({ key: card.key, group: each.group })}
              >
                {GROUP_TITLE[each.group]()}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
