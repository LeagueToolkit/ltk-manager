import {
  CaretRightIcon,
  DiceFiveIcon,
  WarningCircleIcon,
  WaveSineIcon,
} from "@phosphor-icons/react";
import { type ReactNode, use, useMemo } from "react";

import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow, BinRows } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { OpenIntent } from "../palette/types";
import { useOpenDocumentAs } from "../state";
import { AxisCells, ownField, RowValue, ValueMarkCell } from "./BinRow";
import { canExpand, childCount, fieldHash, rowKey } from "./binRows";
import { BinTree } from "./BinTree";
import type { LayoutFrame, PlacedSection } from "./classLayouts";
import { useCurveChain, useCurveDock } from "./curveTarget";
import { CutText } from "./CutText";
import { FieldCard } from "./FieldCard";
import { chunkPath, decideFileLink } from "./linkDecision";
import { drawSummary, randomDraw, rerollsEveryFrame } from "./randomDraw";
import { summaryText } from "./randomText";
import { RowDocumentContext, useRowFold } from "./rowFold";
import { useHeldRows } from "./rowRegistry";
import { Sparkline } from "./Sparkline";
import { TextureSwatch } from "./TextureSwatch";
import { useBinRead } from "./useBinRead";
import {
  joinDeclarations,
  type LinkTargets,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useLayerCopy,
  useLinkTargets,
} from "./useLinkTargets";
import { useValueMark, useValueMarks, ValueMarksContext } from "./useValueMarks";
import { markRanges, sparkKeys, valueFamily, type ValueMark } from "./valueRows";

/** What the levels of a layout's read answered, by the key of the row each sits under. */
export type LayoutPages = ReadonlyMap<string, BinRows>;

/** The open a view draws, which every widget of it reads and resolves against. */
export interface ViewContext {
  /** The open's id, which every read carries. */
  readonly document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  readonly asset: AssetRef;
  /** The class the roots are properties of, which the layout was keyed on. */
  readonly classHash: string;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  readonly objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  readonly onNotOpen: () => void;
  /** The frame it is drawn in, which a widget with two halves reads to place them. */
  readonly frame: LayoutFrame;
}

/** What one section's widget is given: what it placed, what the read answered, and the open. */
export interface WidgetProps {
  readonly section: PlacedSection;
  readonly pages: LayoutPages;
  readonly view: ViewContext;
}

/**
 * The enclosing checks with one more group folded in, for the chips under it.
 *
 * A view checks the rows of its own document. A widget that reads a second one checks
 * that document's rows itself, so a chip drawn out of them resolves the way every
 * other chip of the view does.
 */
export function AlsoCheck({
  document,
  group,
  children,
}: {
  document: BinDocumentId;
  group: RowGroup;
  children: ReactNode;
}) {
  const outer = useLinkTargets();
  const groups = useMemo(() => [group], [group]);
  const inner = useCheckLinkTargets(document, groups);
  const merged = useMemo<LinkTargets>(
    () => ({
      index: inner.index ?? outer.index,
      declared: joinDeclarations(outer.declared, inner.declared),
      located: new Map([...outer.located, ...inner.located]),
      pending: outer.pending || inner.pending,
    }),
    [outer, inner],
  );

  return <LinkTargetsContext value={merged}>{children}</LinkTargetsContext>;
}

/** Every element the read answered under a section's placed rows, in the order placed. */
export function elementsOf(rows: readonly BinRow[], pages: LayoutPages): BinRow[] {
  return rows.flatMap((row) => pages.get(rowKey(row))?.rows ?? []);
}

/** The row the read answered under `row` for `field`, or undefined where it answered none. */
export function childOf(
  pages: LayoutPages,
  row: BinRow | undefined,
  field: string,
): BinRow | undefined {
  if (row === undefined) return undefined;
  return pages.get(rowKey(row))?.rows.find((child) => fieldHash(child.path) === field);
}

/** One element's fields, by field hash, as the read answered them. */
export type FieldsOf = (hash: string) => BinRow | undefined;

export function fieldsOf(page: BinRows | undefined): FieldsOf {
  return fieldsIn(page?.rows ?? []);
}

/** The same, over rows a caller already gathered out of more than one page. */
export function fieldsIn(rows: readonly BinRow[]): FieldsOf {
  const byField = new Map(rows.map((row) => [fieldHash(row.path), row]));
  return (hash) => byField.get(hash);
}

/**
 * One cell of a table, tagged with the row it draws.
 *
 * The tag is what the view's one menu is aimed at, so a right-click on a sampler's
 * path offers that path's own actions rather than the element's.
 */
export function Cell({
  row,
  className,
  children,
}: {
  row: BinRow | undefined;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <span className={className} data-row-key={row === undefined ? undefined : rowKey(row)}>
      {children}
    </span>
  );
}

/** A cell drawing a row's own text, which came from the file and so goes on selecting. */
export function TextCell({ row, className }: { row: BinRow | undefined; className: string }) {
  return (
    <Cell row={row} className={twMerge("truncate select-text", className)}>
      {textOf(row)}
    </Cell>
  );
}

/** The most rows a section's tree shows before it scrolls, so no section owns the page. */
const TREE_ROWS = 12;

interface SectionTreeProps {
  view: ViewContext;
  /** The rows at depth zero: what the section placed, or the elements under them. */
  roots: readonly BinRow[];
  /** The class the roots are properties of. Null where they are a container's elements. */
  rootOwner: string | null;
  /** The tree's accessible name, which is the section's own title. */
  label: string;
  /** The keys open at mount. */
  initialExpanded?: readonly string[];
}

/** A section's rows as the tree draws them, in a box of its own. */
export function SectionTree({ view, roots, rootOwner, label, initialExpanded }: SectionTreeProps) {
  if (roots.length === 0) return <None />;

  return (
    /* DS-GROUND, DS-RADIUS */
    <div className="flex flex-col rounded-md border border-surface-700/50 bg-surface-900">
      <BinTree
        document={view.document}
        asset={view.asset}
        roots={roots}
        rootOwner={rootOwner}
        label={label}
        maxRows={TREE_ROWS}
        initialExpanded={initialExpanded}
        objectName={view.objectName}
        onNotOpen={view.onNotOpen}
      />
    </div>
  );
}

/** The line a section draws where the read answered no row for it. */
export function None() {
  return <span className="text-meta text-surface-400">{m.workshop_bin_section_none_empty()}</span>;
}

/** One row per element of the containers a section placed, drawn by the widget. */
export function TableRows({
  rows,
  children,
}: {
  rows: readonly BinRow[];
  children: (element: BinRow) => ReactNode;
}) {
  if (rows.length === 0) return <None />;
  return (
    <div className="flex flex-col">
      {rows.map((element) => (
        <div
          key={rowKey(element)}
          data-row-key={rowKey(element)}
          /* DS-VEIL, DS-RADIUS */
          className="flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft"
        >
          {children(element)}
        </div>
      ))}
    </div>
  );
}

interface FieldRowProps {
  row: BinRow;
  width?: string;
  /** The class the field is read on, for the revisions its card draws. */
  owner?: string | null;
  /** The roll rail's segment, which only a layout with a roll to draw gives it. */
  rail?: ReactNode;
}

/**
 * One field as its name and the box its value is shaped as, on one line or on two.
 *
 * "A row is shaped as its input" in docs/ux/BIN_EDITOR.md. The name is the field card's
 * trigger, and every layout drawing field rows draws this one.
 */
export function FieldRow({ row, width = "w-40", owner = null, rail }: FieldRowProps) {
  const family = valueFamily(row.value);
  const axes = row.value.type === "vector" ? row.value.values : null;
  const document = use(RowDocumentContext);
  const folds = family === null && axes === null && canExpand(row);
  const [open, toggle] = useRowFold(row);
  const caret = document !== null && folds && <FoldCaret open={open} onToggle={toggle} />;
  const mark = useValueMark(rowKey(row));
  const name = <FieldName row={row} width={width} owner={owner} caret={caret} />;
  const nested = document !== null && folds && open && (
    <NestedRows document={document} row={row} width={width} />
  );

  /* The dynamics rather than the keys, so the row does not fall to two lines under a
     reader once the read lands. "A value the column cannot hold takes a band under its
     name" in docs/ux/BIN_EDITOR.md. */
  if (family !== null && mark?.curve === true) {
    return (
      <>
        {/* DS-VEIL, DS-RADIUS */}
        <div
          className="relative flex flex-col rounded-sm px-1.5 pb-0.5 hover:bg-surface-veil-soft"
          data-row-key={rowKey(row)}
        >
          {rail}
          <span className="flex min-h-6 min-w-0 items-center">{name}</span>
          <span className="flex min-w-0 items-center gap-2">
            <ValueCell row={row} shaped banded railed={rail !== undefined} />
          </span>
        </div>
        {nested}
      </>
    );
  }

  return (
    <>
      {/* DS-VEIL, DS-RADIUS */}
      <div
        className="relative flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft"
        data-row-key={rowKey(row)}
      >
        {rail}
        {name}
        {family !== null && <ValueCell row={row} shaped railed={rail !== undefined} />}
        {family === null && axes !== null && <AxisCells values={axes} />}
        {family === null && axes === null && <RowValue row={row} />}
      </div>
      {nested}
    </>
  );
}

/** A struct's or a list's fold, drawn in the row's gutter so the names stay in one column. */
function FoldCaret({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={m.workshop_bin_row_fields_action()}
      aria-expanded={open}
      className="-ml-3 flex h-4 w-3 shrink-0 cursor-pointer items-center justify-center text-surface-400 hover:text-surface-100"
      onClick={onToggle}
    >
      <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
    </button>
  );
}

const NO_ROWS: readonly BinRow[] = [];

/**
 * A struct's or a list's own rows under it, each a field row of its own.
 *
 * Read on open and marked on its own, since the surface above read only its own rows.
 * Its links are checked and its rows registered for the same reason, so a chip under it
 * resolves and a right-click on it aims the view's menu as on any row of the view.
 */
function NestedRows({
  document,
  row,
  width,
}: {
  document: BinDocumentId;
  row: BinRow;
  width: string;
}) {
  const key = rowKey(row);
  const rows = useMemo(() => [{ key, rows: childCount(row) }], [key, row]);
  const children = useBinRead(document, rows).get(key)?.rows ?? NO_ROWS;
  const families = useMemo(
    () => children.filter((child) => valueFamily(child.value) !== null),
    [children],
  );
  const own = useValueMarks(document, families, "curves");
  const outer = use(ValueMarksContext);
  const marks = useMemo(() => new Map([...outer, ...own]), [outer, own]);
  const group = useMemo<RowGroup>(() => ({ key, rows: children }), [key, children]);
  useHeldRows(children);
  const owner = row.value.type === "struct" ? row.value.classHash : null;

  return (
    <ValueMarksContext value={marks}>
      <AlsoCheck document={document} group={group}>
        <div data-ui="FieldRow:nested" className="flex flex-col gap-0.5 pl-3">
          {children.map((child) => (
            <FieldRow key={rowKey(child)} row={child} width={width} owner={owner} />
          ))}
        </div>
      </AlsoCheck>
    </ValueMarksContext>
  );
}

interface FieldNameProps {
  row: BinRow;
  width: string;
  owner: string | null;
  /** The fold of a row that holds more rows, which opens the name's column. */
  caret: ReactNode;
}

/** The row's name, raw, which is what the field card hangs off. */
function FieldName({ row, width, owner, caret }: FieldNameProps) {
  const field = ownField(row);

  if (field === null) {
    return (
      <span className={twMerge("flex min-w-0 shrink-0", width)}>
        {caret}
        <CutText text={row.name} className="text-surface-200" />
      </span>
    );
  }
  return (
    <span className={twMerge("flex min-w-0 shrink-0", width)}>
      {caret}
      <FieldCard
        classHash={owner}
        fieldHash={field}
        name={row.name}
        unnamed={row.unnamed}
        declared={row.declared}
        triggerClassName="text-surface-200"
        cut
      />
    </span>
  );
}

/**
 * A value family's constant, and what carries the rest of it where a curve does.
 *
 * "A value family in a layout" in docs/ux/BIN_EDITOR.md. The shape where the read
 * answered the keys, and the mark where it read only that there are some. `shaped` is a
 * field row, whose vector takes tinted columns and whose scalar carries its unit.
 */
export function ValueCell({
  row,
  shaped = false,
  banded = false,
  railed = false,
}: {
  row: BinRow;
  shaped?: boolean;
  /** The cell has the row's own band to itself, so its curve is drawn at that width. */
  banded?: boolean;
  /** The layout draws a roll rail, which already says when the table is re-rolled. */
  railed?: boolean;
}) {
  const mark = useValueMark(rowKey(row));
  const keys = sparkKeys(mark);
  const { aim } = useCurveDock();
  const chain = useCurveChain(row.name);
  const stretch = banded && keys.length > 0;

  /* Both of Riot's editors put the constant inline and the triggers after it, so a reader
     tuning a value sees what it is worth and reaches the rest of it from the same row. The
     probability tables live inside the dynamics, so the chip only ever sits beside a curve. */
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <ValueMarkCell mark={mark} axes={shaped} field={shaped ? ownField(row) : null} />
      {mark?.curve === true && (
        <span
          className={twMerge("flex items-center gap-0.5", stretch ? "min-w-0 flex-1" : "shrink-0")}
        >
          <Trigger
            label={m.workshop_bin_show_curve_action()}
            className={twMerge(stretch && "min-w-0 flex-1")}
            onClick={() => aim({ row, chain })}
          >
            {keys.length > 0 && (
              <Sparkline
                keys={keys}
                label={m.workshop_bin_curve_keys_label({ count: keys.length })}
                wide={stretch}
              />
            )}
            {keys.length === 0 && (
              <WaveSineIcon
                weight="bold"
                role="img"
                aria-label={m.workshop_bin_value_curve_label()}
                className="h-3.5 w-3.5 shrink-0"
              />
            )}
          </Trigger>
          <RandomChip row={row} mark={mark} chain={chain} shaped={shaped} railed={railed} />
        </span>
      )}
    </span>
  );
}

/**
 * What a table randomizes on the row, which aims the dock's graph the spread draws on.
 *
 * "The row's two triggers" in docs/ux/BIN_EDITOR.md. A bare die until the tables are read,
 * and nothing once they read as filler.
 */
function RandomChip({
  row,
  mark,
  chain,
  shaped,
  railed,
}: {
  row: BinRow;
  mark: ValueMark | undefined;
  chain: string;
  shaped: boolean;
  railed: boolean;
}) {
  const { aim } = useCurveDock();
  const draw = randomDraw(mark);
  const summary = draw === null ? null : drawSummary(draw);
  if (mark === undefined || (mark.slots !== undefined && summary === null)) return null;

  /* A rail already says a per-frame table where the layout draws one, per "The row's two
     triggers" in docs/ux/BIN_EDITOR.md, so the chip reads the shape rather than saying it twice. */
  const flickers =
    !railed && summary !== null && summary.kind !== "broken" && rerollsEveryFrame(ownField(row));
  /* The value column draws the range already where it could read one. */
  const ranged = shaped && markRanges(mark) !== null;
  const text = summary === null ? null : summaryText(summary, mark.family, ranged);

  return (
    <Trigger
      label={m.workshop_bin_show_random_action()}
      /* DS-TEXT */
      className={twMerge(
        summary?.kind === "broken" && "text-danger-text",
        flickers && "text-warning-text",
      )}
      onClick={() => aim({ row, chain, tab: "graph" })}
    >
      <DiceFiveIcon weight="bold" className="h-3.5 w-3.5 shrink-0" />
      {flickers && (
        <span className="ml-1 font-sans text-meta whitespace-nowrap">
          {m.workshop_bin_random_flicker_label()}
        </span>
      )}
      {!flickers && text !== null && (
        <span className="ml-1 font-sans text-meta whitespace-nowrap">{text}</span>
      )}
    </Trigger>
  );
}

/** One of the row's triggers, which aims the dock at a reading rather than writing anything. */
function Trigger({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      /* DS-RADIUS, DS-VEIL */
      className={twMerge(
        "flex cursor-pointer items-center rounded-sm px-0.5 text-surface-400 hover:bg-surface-veil hover:text-surface-200",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** How big a texture cell is drawn: an emitter card's square, a tile, or a row swatch. */
export type TileSize = "card" | "tile" | "row";

/** The room each size takes, and the mark that fits in it. */
const EMPTY_BOX: Record<TileSize, { box: string; mark: string }> = {
  card: { box: "aspect-square w-full", mark: "h-5 w-5" },
  tile: { box: "h-12 w-12", mark: "h-4 w-4" },
  row: { box: "h-5 w-5", mark: "h-3 w-3" },
};

/** A texture at `size`, for a `file` and for a string that resolves as one. */
export function TextureTile({ row, size = "tile" }: { row: BinRow | undefined; size?: TileSize }) {
  const targets = useLinkTargets();
  const path = texturePath(row);
  const layer = useLayerCopy(path);
  const open = useOpenDocumentAs();
  const decision = decideFileLink(path, targets, layer);

  const fileKind = path === null ? "unknown" : fileKindFromPath(path);
  if (decision.kind === "missing") return <EmptyTile size={size} missing />;
  if (decision.kind !== "chip" || path === null || !isTexture(fileKind)) {
    return <EmptyTile size={size} />;
  }
  return (
    <TextureSwatch
      asset={decision.document.asset}
      path={path}
      fileKind={fileKind}
      layerTitle={layer?.title}
      size={size}
      onOpen={(intent: OpenIntent) => open(decision.document, intent)}
    />
  );
}

/**
 * The tile a cell keeps when its texture does not draw, so one left edge holds.
 *
 * A missing chunk marks the tile. The row's own path carries what the mark means.
 */
export function EmptyTile({
  size = "tile",
  missing = false,
}: {
  size?: TileSize;
  missing?: boolean;
}) {
  return (
    <span
      /* DS-VEIL, DS-RADIUS */
      className={twMerge(
        "flex shrink-0 items-center justify-center rounded-sm border border-surface-veil-strong bg-surface-veil-soft",
        EMPTY_BOX[size].box,
        missing && "border-warning/30",
      )}
      aria-hidden
    >
      {missing && (
        <WarningCircleIcon
          weight="bold"
          className={twMerge("text-warning-text", EMPTY_BOX[size].mark)}
        />
      )}
    </span>
  );
}

/** The chunk path a texture field names, whether it crosses as a `file` or as a string. */
export function texturePath(row: BinRow | undefined): string | null {
  if (row?.value.type === "wadChunkLink") return row.value.path;
  if (row?.value.type === "string") return chunkPath(row.value.value);
  return null;
}

function isTexture(kind: ReturnType<typeof fileKindFromPath>): boolean {
  return kind === "texture" || kind === "texture_dds";
}

/** A field's value where it is a string, which is what a table's name column draws. */
export function textOf(row: BinRow | undefined): string | undefined {
  return row?.value.type === "string" ? row.value.value : undefined;
}
