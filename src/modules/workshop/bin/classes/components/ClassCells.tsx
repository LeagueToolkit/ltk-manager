import {
  CaretRightIcon,
  DiceFiveIcon,
  MinusIcon,
  WarningCircleIcon,
  WaveSineIcon,
} from "@phosphor-icons/react";
import { type ReactNode, use, useMemo } from "react";

import {
  DataTable,
  DataTableCells,
  DataTableHeaders,
  type DataTableColumn,
  InputDefaultContext,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow, BinRows } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { fileKindFromPath } from "../../../gameBrowser/utils/fileKind";
import type { OpenIntent } from "../../../palette/utils/types";
import { useOpenDocumentAs } from "../../../state";
import { useCurveChain, useCurveDock } from "../../curves/state/curveTarget";
import {
  CURVE_DYNAMICS,
  curveActivationEdits,
  curveDynamicsClass,
} from "../../curves/utils/curveEdits";
import { drawSummary, randomDraw, rerollsEveryFrame } from "../../curves/utils/randomDraw";
import { summaryText } from "../../curves/utils/randomText";
import { DeclaredRowState } from "../../documents/components/DeclaredLayer";
import { useBinRead } from "../../documents/hooks/useBinRead";
import { TextureSwatch } from "../../links/components/TextureSwatch";
import {
  joinDeclarations,
  type LinkTargets,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useLayerCopy,
  useLinkTargets,
} from "../../links/hooks/useLinkTargets";
import { chunkPath, decideFileLink } from "../../links/utils/linkDecision";
import { CutText } from "../../shared/components/CutText";
import { AxisCells, ownField, RowValue, ValueMarkCell } from "../../tree/components/BinRow";
import { BinTree } from "../../tree/components/BinTree";
import { LeafEditContext, type Reopen } from "../../tree/hooks/useLeafEdit";
import { RowDocumentContext, useRowFold } from "../../tree/state/rowFold";
import { useHeldRows } from "../../tree/state/rowRegistry";
import { canExpand, childCount, fieldHash, rowKey } from "../../tree/utils/binRows";
import { useValueMark, useValueMarks, ValueMarksContext } from "../../values/hooks/useValueMarks";
import { markRanges, valueFamily, type ValueMark } from "../../values/utils/valueRows";
import { FieldLabelsContext } from "../state/fieldLabels";
import type { LayoutFrame, PlacedSection } from "../utils/classLayouts";
import { ClassCard } from "./ClassCard";
import { FieldCard } from "./FieldCard";

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
  /** The object the view draws, which a widget adding a field it lacks writes under. */
  readonly entry: string;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  readonly objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  readonly onNotOpen: Reopen;
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
      strings: new Map([...outer.strings, ...inner.strings]),
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
  return (
    <span className="px-1.5 text-meta text-surface-400">{m.workshop_bin_section_none_empty()}</span>
  );
}

/** The name column a layout's field rows share, measured into `--name-width` by the view. */
export const NAME_COLUMN = "w-[var(--name-width,10rem)]";

/** How far one level of nesting indents a name inside its column. */
const INDENT = "0.75rem";

const ROW_CLASS = "flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft";

/** What draws one table row around its cells. */
export type TableRowFrame = (props: {
  element: BinRow;
  className: string;
  children: React.ReactNode;
}) => React.ReactNode;

/** A table row with nothing of its own. */
function PlainRow({
  element,
  className,
  children,
}: {
  element: BinRow;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div data-row-key={rowKey(element)} className={className}>
      {children}
    </div>
  );
}

/** One row per element of the containers a section placed, drawn by the widget. */
export function TableRows({
  rows,
  columns,
  showHeader = false,
  Row = PlainRow,
}: {
  rows: readonly BinRow[];
  columns: DataTableColumn<BinRow>[];
  showHeader?: boolean;
  /** What wraps each row, for a widget whose rows answer the pointer. */
  Row?: TableRowFrame;
}) {
  return (
    <DataTable
      ariaLabel={m.workshop_bin_row_fields_action()}
      options={{ data: rows, columns, getRowId: rowKey, enableSorting: false }}
    >
      {(table) => (
        <div className="flex flex-col">
          {showHeader && (
            <div className="flex gap-2 px-1.5 pb-0.5 text-meta text-surface-400">
              <DataTableHeaders headers={table.getFlatHeaders()} customCells />
            </div>
          )}
          {rows.length === 0 && <None />}
          {table.getRowModel().rows.map((row) => (
            /* DS-VEIL, DS-RADIUS */
            <Row key={row.id} element={row.original} className={ROW_CLASS}>
              <DataTableCells row={row} customCells />
            </Row>
          ))}
        </div>
      )}
    </DataTable>
  );
}

/** Rows each drawn as a field row, down one column, and None where there are none. */
export function FieldRows({
  rows,
  owner = null,
  depth = 0,
}: {
  rows: readonly BinRow[];
  owner?: string | null;
  depth?: number;
}) {
  if (rows.length === 0) return <None />;
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <FieldRow key={rowKey(row)} row={row} owner={owner} depth={depth} />
      ))}
    </div>
  );
}

interface FieldRowProps {
  row: BinRow;
  label?: string;
  /** Multi-component and value-family fields place their labels above the controls. */
  verticalValues?: boolean;
  tableLayout?: boolean;
  width?: string;
  /** How many structs the row sits inside, which indents its name within the column. */
  depth?: number;
  /** The class the field is read on, for the revisions its card draws. */
  owner?: string | null;
  /** The roll rail's segment, which only a layout with a roll to draw gives it. */
  rail?: ReactNode;
  valueSlot?: ReactNode;
  valueAction?: ReactNode;
}

/**
 * One field on a line of its own: its name, and the box its value is shaped as.
 *
 * "A row is shaped as its input" in docs/ux/BIN_EDITOR.md. The name is the field card's
 * trigger, and every layout drawing field rows draws this one. The indent sits inside
 * the name column, so every depth's value starts at one x.
 */
export function FieldRow({
  row,
  label,
  width = NAME_COLUMN,
  depth = 0,
  owner = null,
  rail,
  verticalValues = false,
  tableLayout = false,
  valueSlot,
  valueAction,
}: FieldRowProps) {
  const labels = use(FieldLabelsContext);
  const displayLabel = label ?? labels?.(ownField(row) ?? "", row.name);
  const family = valueFamily(row.value);
  const axes = row.value.type === "vector" ? row.value.values : null;
  const vertical =
    verticalValues &&
    (family !== null || axes !== null || row.value.type === "color" || row.value.type === "matrix");
  const editable = use(LeafEditContext) !== null;
  const document = use(RowDocumentContext);
  const folds = document !== null && family === null && axes === null && canExpand(row);
  const [open, toggle] = useRowFold(row);
  const caret = folds ? <FoldCaret open={open} onToggle={toggle} /> : <FoldGutter />;
  const nameWidth = vertical ? "w-full" : width;
  const name = (
    <FieldName
      row={row}
      label={displayLabel}
      width={nameWidth}
      depth={depth}
      owner={owner}
      caret={caret}
    />
  );
  const nested = folds && open && (
    <NestedRows
      document={document}
      row={row}
      width={width}
      depth={depth + 1}
      verticalValues={verticalValues}
      tableLayout={tableLayout}
    />
  );

  return (
    <>
      {/* DS-VEIL, DS-RADIUS. A click anywhere on a row that holds rows folds it, as on a
          tree row, and the chips on it stop the click themselves. */}
      <div
        className={twMerge(
          "relative flex min-h-6 items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft",
          family !== null && "items-start",
          vertical && "flex-col items-stretch gap-0.5 py-1",
          tableLayout && "gap-0 rounded-none",
          folds && "cursor-pointer",
        )}
        data-row-key={rowKey(row)}
        aria-expanded={folds ? open : undefined}
        onClick={folds ? toggle : undefined}
      >
        {rail}
        {name}
        <div
          data-ui="FieldRow:value"
          className={twMerge(
            "flex min-w-0 flex-1 items-center gap-2",
            vertical && "w-full pl-4",
            tableLayout && "min-h-6 border-l border-surface-700/40 pl-2",
          )}
        >
          {valueSlot}
          {valueSlot === undefined && family !== null && (
            <ValueCell row={row} shaped railed={rail !== undefined} />
          )}
          {valueSlot === undefined && family === null && axes !== null && !editable && (
            <AxisCells values={axes} />
          )}
          {valueSlot === undefined && family === null && axes !== null && editable && (
            <RowValue row={row} />
          )}
          {valueSlot === undefined &&
            family === null &&
            axes === null &&
            row.node === "element" && <ElementClass value={row.value} />}
          {valueSlot === undefined && family === null && axes === null && <RowValue row={row} />}
          {valueAction}
          <DeclaredRowState rowKey={rowKey(row)} />
        </div>
      </div>
      {nested}
    </>
  );
}

/** The class an element's struct holds, which the tree draws beside the element's index. */
function ElementClass({ value }: { value: BinRow["value"] }) {
  if (value.type !== "struct") return null;
  return <ClassCard classHash={value.classHash} name={value.class} />;
}

/** The gutter every field row's name starts with, which a fold's caret stands in. */
const GUTTER = "h-6 w-4 shrink-0";

/**
 * A struct's or a list's fold, in the gutter before the name so the names stay in one
 * column. The row itself folds on a click too, so the caret keeps its click to itself.
 */
export function FoldCaret({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={m.workshop_bin_row_fields_action()}
      aria-expanded={open}
      className={twMerge(
        GUTTER,
        "flex cursor-pointer items-center justify-center text-surface-400 hover:text-surface-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
    </button>
  );
}

/** The gutter of a row that folds nothing, so its name lines up with one that does. */
function FoldGutter() {
  return <span aria-hidden className={GUTTER} />;
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
  depth,
  verticalValues,
  tableLayout,
}: {
  document: BinDocumentId;
  row: BinRow;
  width: string;
  depth: number;
  verticalValues: boolean;
  tableLayout: boolean;
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
        <div data-ui="FieldRow:nested" className="flex flex-col gap-0.5">
          {children.map((child) => (
            <FieldRow
              key={rowKey(child)}
              row={child}
              width={width}
              depth={depth}
              owner={owner}
              verticalValues={verticalValues}
              tableLayout={tableLayout}
            />
          ))}
        </div>
      </AlsoCheck>
    </ValueMarksContext>
  );
}

interface FieldNameProps {
  row: BinRow;
  label?: string;
  width: string;
  depth: number;
  owner: string | null;
  /** The fold of a row that holds more rows, which opens the name's column. */
  caret: ReactNode;
}

/** The row's name, raw, which is what the field card hangs off. */
function FieldName({ row, label, width, depth, owner, caret }: FieldNameProps) {
  const implicit = use(InputDefaultContext);
  const field = ownField(row);
  const indent = depth > 0 && (
    <span aria-hidden className="shrink-0" style={{ width: `calc(${INDENT} * ${depth})` }} />
  );

  if (field === null) {
    return (
      <span className={twMerge("flex min-w-0 shrink-0 items-center", width)}>
        {indent}
        {caret}
        <CutText text={row.name} className="text-surface-200" />
      </span>
    );
  }
  return (
    <span className={twMerge("flex min-w-0 shrink-0 items-center", width)}>
      {indent}
      {caret}
      <FieldCard
        classHash={owner}
        fieldHash={field}
        name={row.name}
        label={label}
        unnamed={row.unnamed}
        declared={row.declared}
        triggerClassName={twMerge(
          "text-surface-200",
          label && "font-sans font-medium",
          implicit && "font-normal text-surface-400",
        )}
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
  railed = false,
}: {
  row: BinRow;
  shaped?: boolean;
  /** The layout draws a roll rail, which already says when the table is re-rolled. */
  railed?: boolean;
}) {
  const mark = useValueMark(rowKey(row));
  const { aim, clear, target } = useCurveDock();
  const chain = useCurveChain(row.name);
  const edit = use(LeafEditContext);
  const editable = edit !== null;
  const constant = editable ? mark?.constantRow : undefined;
  const valueClass = row.value.type === "struct" ? row.value.classHash : null;
  const dynamicsClass = curveDynamicsClass(valueClass);
  const curve = mark?.curve === true;
  const canActivate = edit?.editProperty !== undefined && dynamicsClass !== null;

  async function activateCurve() {
    if (edit?.editProperty === undefined || valueClass === null) return;

    const edits = curveActivationEdits(valueClass, mark?.constant ?? null, "dynamics");
    if (edits === null) return;

    const activated = await edit.editProperty(row, CURVE_DYNAMICS, edits);
    if (!activated || row.value.type !== "struct") return;

    aim({ row: { ...row, value: { ...row.value, len: row.value.len + 1 } }, chain, tab: "graph" });
  }

  async function deactivateCurve() {
    if (edit?.setPointer === undefined) return;

    const cleared = await edit.setPointer(row, CURVE_DYNAMICS, null);
    if (cleared && target !== null && rowKey(target.row) === rowKey(row)) clear();
  }

  return (
    <span
      className={twMerge(
        "flex min-w-0 flex-1 items-center gap-2",
        shaped && "flex-wrap gap-y-1 py-0.5",
      )}
    >
      {constant !== undefined && <RowValue row={constant} field={ownField(row)} />}
      {constant === undefined && (
        <ValueMarkCell mark={mark} axes={shaped} field={shaped ? ownField(row) : null} />
      )}
      {mark?.constantRow !== undefined && <DeclaredRowState rowKey={rowKey(mark.constantRow)} />}
      {(curve || canActivate) && (
        <CurveToggle
          active={curve}
          onCurve={curve ? () => aim({ row, chain, tab: "graph" }) : () => void activateCurve()}
          onConstant={edit?.setPointer === undefined ? undefined : () => void deactivateCurve()}
        />
      )}
      {curve && <RandomChip row={row} mark={mark} chain={chain} shaped={shaped} railed={railed} />}
    </span>
  );
}

/** The compact row action that creates or opens a value's dynamics. */
export function CurveToggle({
  active = false,
  onCurve,
  onConstant,
}: {
  active?: boolean;
  onCurve: () => void;
  onConstant?: () => void;
}) {
  const curveLabel = active
    ? m.workshop_bin_force_curve_action()
    : m.workshop_bin_enable_curve_action();

  return (
    <span
      role="group"
      aria-label={m.workshop_bin_value_mode_label()}
      className="inline-flex h-5 shrink-0 overflow-hidden rounded-sm border border-surface-veil-strong"
    >
      <Tooltip content={m.workshop_bin_use_constant_action()}>
        <button
          type="button"
          aria-label={m.workshop_bin_use_constant_action()}
          aria-pressed={!active}
          disabled={onConstant === undefined}
          className={twMerge(
            "flex h-full w-5 cursor-pointer items-center justify-center border-r border-surface-veil-strong text-surface-500 transition-colors hover:bg-surface-veil hover:text-surface-200 disabled:cursor-not-allowed disabled:opacity-50",
            !active && "bg-surface-veil-strong text-surface-200",
          )}
          onClick={onConstant}
        >
          <MinusIcon weight="bold" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <Tooltip content={curveLabel}>
        <button
          type="button"
          aria-label={curveLabel}
          aria-pressed={active}
          className={twMerge(
            "flex h-full w-5 cursor-pointer items-center justify-center text-surface-500 transition-colors hover:bg-surface-veil hover:text-surface-200",
            active && "bg-surface-veil-strong text-accent-400",
          )}
          onClick={onCurve}
        >
          <WaveSineIcon weight="bold" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
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
  if (mark === undefined || summary === null) return null;

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
