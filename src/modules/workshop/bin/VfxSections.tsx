import { EyeSlashIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import { Field, SegmentedControl } from "@/components";
import { useHorizontalWheel } from "@/hooks";
import { m } from "@/i18n";
import type { BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { CHECKERBOARD } from "../preview/ImagePreview";
import { rowKey } from "./binRows";
import {
  Cell,
  EmptyTile,
  None,
  texturePath,
  TextureTile,
  type TileSize,
  type WidgetProps,
} from "./ClassCells";
import { nameOf } from "./emitterCards";
import { useEmitters } from "./emitterChoice";
import { CARD, type EmitterGroup, GROUP_TITLE } from "./emitterGroups";
import { EmitterPanel } from "./EmitterInspector";
import { EmitterTable } from "./EmitterTable";
import type { EmitterCardData } from "./emitterTypes";
import { useValueMark } from "./useValueMarks";
import { channels, colorCss, type ColorStop, colorStops, gradientCss } from "./valueRows";

/**
 * The room a card takes, which is what a typical emitter name reads in.
 *
 * A card a reader cannot tell from the next one is worth nothing however many of them
 * fit, and in a pane the count comes from the rows the grid wraps into rather than from
 * how narrow one card is.
 */
const CARD_WIDTH = "w-36";

/** The panel scrolls past this, so a group of thirty fields owns no more of the page. */
const PANEL_HEIGHT = "max-h-72";

/**
 * The Emitters section, as a strip of cards or as the table of columns.
 *
 * "The emitter strip" in docs/ux/BIN_EDITOR.md. A stack draws the panel under the strip.
 * A shell draws it in the inspector column, so this half stops at the strip.
 */
export function Emitters({ section, pages, view }: WidgetProps) {
  const { mode } = useEmitters();

  /* A pane's own strip carries the filter and the reading, so the section drawn in one
     is the cards alone. */
  if (view.frame === "shell") {
    if (mode === "cards") return <EmitterGrid />;
    return (
      /* DS-SCROLLBAR */
      <div className="min-h-0 flex-1 overflow-auto scrollbar-md">
        <EmitterTable section={section} pages={pages} view={view} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <EmitterModes />
      {mode === "cards" && (
        <div className="flex flex-col gap-1.5">
          <EmitterStrip />
          <EmitterPanel className={PANEL_HEIGHT} />
        </div>
      )}
      {mode === "table" && <EmitterTable section={section} pages={pages} view={view} />}
    </div>
  );
}

/**
 * What narrows the strip, how much of it is drawn, and which reading.
 *
 * A stack draws it over the strip. A shell hands it to the pane's own strip, so the
 * controls of every pane sit in the one place a reader looks for them.
 */
export function EmitterModes() {
  const { mode, setMode, filter, setFilter, cards, total } = useEmitters();

  return (
    <div className="flex items-center gap-2">
      <Field.Control
        className="h-6 w-40 px-2 font-sans text-meta"
        aria-label={m.workshop_bin_emitter_filter_label()}
        placeholder={m.workshop_bin_emitter_filter_placeholder()}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      {filter.trim() !== "" && (
        <span className="text-meta text-surface-400 select-none">
          {m.workshop_bin_emitter_shown_label({ shown: cards.length, total })}
        </span>
      )}
      <SegmentedControl
        size="xs"
        className="ml-auto font-sans"
        aria-label={m.workshop_bin_emitter_view_label()}
        value={mode}
        onChange={setMode}
        options={[
          { value: "cards", label: m.workshop_bin_emitter_view_cards_label() },
          { value: "table", label: m.workshop_bin_emitter_view_table_label() },
        ]}
      />
    </div>
  );
}

/** Every emitter as a card, in the one row a stack gets. */
function EmitterStrip() {
  const { cards, rootOpen: open } = useEmitters();
  const strip = useRef<HTMLDivElement>(null);
  useHorizontalWheel(strip);

  if (cards.length === 0) return <None />;
  return (
    /* DS-SCROLLBAR */
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

/**
 * The same cards wrapped into as many rows as the pane leaves room for.
 *
 * A pane is sized by the reader rather than by the column it sat in, so the count on
 * screen is theirs to set. Sixty emitters are a sideways walk in one row and a page in a
 * grid.
 */
function EmitterGrid() {
  const { cards, rootOpen: open } = useEmitters();

  if (cards.length === 0) return <None />;
  return (
    /* DS-SCROLLBAR */
    <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sm">
      <div className="flex flex-wrap content-start items-start gap-1.5 pb-1">
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

/** A card: what the emitter is called, what it looks like, and what it sets. */
function EmitterCard({ card, open }: { card: EmitterCardData; open: EmitterGroup | null }) {
  const { target, child, chooseCard, chooseGroup } = useEmitters();
  const aimed = child === null ? target : null;
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
        aria-pressed={open !== null}
        /* DS-RADIUS, DS-VEIL */
        className={twMerge(
          "flex cursor-pointer items-center gap-1 rounded-sm px-0.5 text-left hover:bg-surface-veil",
          open !== null && aimed === "emitter" && "bg-accent-500/15",
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
              open === each.group
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

/**
 * The emitter's texture, the colour it births with where it has none, else the tile.
 *
 * `card` fills a card's width, and `row` is the 20 px square a lane's head carries.
 */
export function CardSquare({
  card,
  size = "card",
}: {
  card: EmitterCardData;
  size?: Extract<TileSize, "card" | "row">;
}) {
  const texture = card.fields(CARD.texture);
  const colour = card.fields(CARD.colour);
  const mark = useValueMark(colour === undefined ? undefined : rowKey(colour));
  const stops = mark?.family === "color" ? colorStops(mark.keys) : [];
  const rgba = mark?.family === "color" ? channels(mark.constant) : null;
  const background = squareBackground(stops, rgba);

  if (texturePath(texture) !== null) return <TextureTile row={texture} size={size} />;
  if (colour !== undefined && background !== null) {
    return <ColourSquare row={colour} background={background} size={size} />;
  }
  return <EmptyTile size={size} />;
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
function ColourSquare({
  row,
  background,
  size,
}: {
  row: BinRow;
  background: string;
  size: Extract<TileSize, "card" | "row">;
}) {
  return (
    <Cell
      row={row}
      /* DS-TOKEN, DS-VEIL, DS-RADIUS */
      className={twMerge(
        "block shrink-0 overflow-hidden rounded-sm border border-surface-veil-strong [background-size:8px_8px]",
        CHECKERBOARD,
        size === "card" ? "aspect-square w-full" : "h-5 w-5",
      )}
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
