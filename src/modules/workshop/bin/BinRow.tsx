import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";

import { Checkbox, Code, Readout, SeverityGlyph, Tooltip } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { AppError, BinRow, BinValue, RowNode } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { ObjectGlyph } from "../components/ObjectGlyph";
import type { OpenIntent } from "../palette/types";
import { clickIntent } from "../state";
import {
  canExpand,
  fieldHash,
  INDENT,
  MAX_INDENT_DEPTH,
  rowKey,
  type RowLine,
  type VisibleRow,
} from "./binRows";
import { ClassCard } from "./ClassCard";
import { ColorMark } from "./ColorMark";
import { DeclaredLine, FieldCard } from "./FieldCard";
import { enumReading } from "./fieldEnums";
import { type FieldUnit, fieldUnit, UNIT_SUFFIX } from "./fieldUnits";
import { rowTag } from "./kindTag";
import { FileChip, ObjectChip, StringValue } from "./LinkChip";
import { useValueMark } from "./useValueMarks";
import { channels, colorStops, markRanges, type ValueMark, type ValueRange } from "./valueRows";

/** One line, which is what sizes the virtualizer. A matrix opened in place grows past it. */
export const ROW_HEIGHT = 24;

const AXES = ["x", "y", "z", "w"] as const;
const CHANNELS = ["r", "g", "b", "a"] as const;

/** The room a number on its own takes, so a column of rows lines its digits up. */
const SCALAR_WIDTH = "w-32";

/** One component of a vector or a matrix, which holds a float. */
const COMPONENT_WIDTH = "w-24";

/** One channel of a colour, which holds a byte. */
const CHANNEL_WIDTH = "w-14";

/** What stands between a random range's bounds, "The inspector" in docs/ux/BIN_EDITOR.md. */
const RANGE_SEPARATOR = "..";

interface RowLineProps {
  line: RowLine;
  /** The reveal landed on this row. */
  focused: boolean;
  /** The fetch of the rows under this one failed. */
  error?: AppError;
  onToggle: (key: string) => void;
  /** Open the object an object row declares. Absent where no row is an object. */
  onOpenObject?: (row: BinRow, intent: OpenIntent) => void;
}

/** One node of the bin: its name, its kind as a tag, and its value. */
export function BinRowLine({ line, focused, error, onToggle, onOpenObject }: RowLineProps) {
  const { row, depth, expanded, loading } = line;
  const expandable = canExpand(row);

  return (
    <div
      data-ui="BinDocument:row"
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      className={twMerge(
        /* DS-VEIL, DS-RADIUS. No transition: a fade in and out under a pointer crossing
           a list of 24px rows reads as a flicker rather than as a highlight. */
        "group/row flex min-h-6 items-center gap-2 rounded-sm pr-2 text-mono-row hover:bg-surface-veil-soft",
        expandable && "cursor-pointer",
        focused && "bg-accent-500/15",
      )}
      onClick={() => expandable && onToggle(line.key)}
    >
      <NameCell line={line} expandable={expandable} expanded={expanded} loading={loading} />
      <RowValue row={row} />
      {error && (
        <Tooltip content={errorSummary(error)}>
          <WarningCircleIcon className="h-3.5 w-3.5 shrink-0 text-warning-text" />
        </Tooltip>
      )}
      {row.node === "object" && onOpenObject && (
        <OpenObjectAction onOpen={(intent) => onOpenObject(row, intent)} />
      )}
    </div>
  );
}

/** The object row's hover action, opening its object tab. `Ctrl+click` opens it beside. */
function OpenObjectAction({ onOpen }: { onOpen: (intent: OpenIntent) => void }) {
  const label = m.workshop_bin_open_object_action();
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        /* DS-VEIL, DS-RADIUS */
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 opacity-0 group-hover/row:opacity-100 hover:bg-surface-veil hover:text-surface-200 focus-visible:opacity-100"
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          onOpen(clickIntent(event));
        }}
      >
        <ArrowSquareOutIcon weight="bold" className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

interface MoreRowProps {
  line: Extract<VisibleRow, { kind: "more" }>;
}

/** The line under a node whose rows have not all answered. */
export function MoreRow({ line }: MoreRowProps) {
  return (
    <div className="flex h-6 items-center gap-2 pr-2 text-meta text-surface-400">
      <Guides depth={line.depth} />
      <span className="w-3 shrink-0" />
      <SpinnerGapIcon className="h-3 w-3 animate-spin" />
      <span>{m.workshop_bin_more_label({ loaded: line.loaded, total: line.total })}</span>
    </div>
  );
}

/** One guide per open level, each under the caret of the level it belongs to. */
function Guides({ depth }: { depth: number }) {
  const indented = Math.min(depth, MAX_INDENT_DEPTH);
  const stacked = depth - indented;
  return (
    <span className="flex shrink-0 translate-x-[6px] self-stretch" aria-hidden>
      {Array.from({ length: indented }, (_, level) => (
        <span
          key={level}
          className="shrink-0 border-l border-surface-700/60"
          style={{ width: INDENT }}
        />
      ))}
      {Array.from({ length: stacked }, (_, level) => (
        <span key={`stacked-${level}`} className="w-0.5 shrink-0 border-l border-surface-700/60" />
      ))}
    </span>
  );
}

interface CaretProps {
  expandable: boolean;
  expanded: boolean;
  loading: boolean;
}

function Caret({ expandable, expanded, loading }: CaretProps) {
  return (
    <span className="flex h-4 w-3 shrink-0 items-center justify-center text-surface-400">
      {loading && <SpinnerGapIcon className="h-3 w-3 animate-spin" />}
      {!loading && expandable && (
        <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", expanded && "rotate-90")} />
      )}
    </span>
  );
}

interface NameCellProps {
  line: RowLine;
  expandable: boolean;
  expanded: boolean;
  loading: boolean;
}

/**
 * The row's name, and its tag after it. "The property row" in docs/ux/BIN_EDITOR.md.
 *
 * The indent is inside this cell rather than beside it, so the value column starts at one
 * x whatever the depth is and a run of rows reads as a column.
 */
function NameCell({ line, expandable, expanded, loading }: NameCellProps) {
  const { row, owner, depth } = line;
  const object = row.node === "object";
  const property = row.node === "property";
  const element = row.node === "element";
  const held = element && row.value.type === "struct" ? row.value : null;
  const nameClasses = twMerge(
    /* An element's index is what a reader counts rows by, so the class beside it elides first. */
    element ? "shrink-0" : "truncate",
    object ? "font-medium text-surface-100" : "text-surface-200",
    element && "text-surface-400",
    row.unnamed && "text-surface-300",
  );

  return (
    <span
      className={twMerge(
        "flex min-w-0 shrink-0 items-center gap-1.5",
        /* An element sits outside the column: its value follows its index rather than
           starting where a property's value does. */
        object || element ? "max-w-[60%]" : "w-[min(calc(var(--bin-name-cols)*1ch+2rem),50%)]",
      )}
    >
      <Guides depth={depth} />
      <Caret expandable={expandable} expanded={expanded} loading={loading} />
      {object && (
        <ObjectGlyph
          objectClass={row.value.type === "struct" ? row.value.class : null}
          className="h-3.5 w-3.5 shrink-0 text-surface-400"
        />
      )}
      {property && (
        <FieldCard
          classHash={owner}
          fieldHash={fieldHash(row.path)}
          name={row.name}
          unnamed={row.unnamed}
          declared={row.declared}
          triggerClassName={nameClasses}
        />
      )}
      {!property && <span className={nameClasses}>{row.name}</span>}
      {held && <ClassCard classHash={held.classHash} name={held.class} />}
      {!object && !element && <KindTag row={row} />}
    </span>
  );
}

/** The row's kind in ritobin's words, and the Problems mark where the schema declares another. */
function KindTag({ row }: { row: BinRow }) {
  const tag = rowTag(row);
  if (tag === null) return null;
  const mismatch = row.declared !== null && row.declared.mismatch;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {mismatch && (
        <Tooltip content={<DeclaredLine declared={row.declared} />}>
          <span role="img" aria-label={m.workshop_bin_mismatch_label()} className="flex">
            <SeverityGlyph severity="warning" />
          </span>
        </Tooltip>
      )}
      <span className={TAG_CLASSES}>{tag}</span>
    </span>
  );
}

/* A plain span rather than a component: the tooltip's render prop spreads its handlers
   onto the element it is given. */
/* DS-KIND-HUE, DS-TEXT */
const TAG_CLASSES = "text-bin-kind-text";

/**
 * The cell a row's value draws, which is what a class view places where its layout
 * names no widget of its own.
 */
export function RowValue({ row }: { row: BinRow }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Value value={row.value} node={row.node} rowKey={rowKey(row)} field={ownField(row)} />
    </span>
  );
}

/** The field hash a row's own tables are keyed on, and null for a row that is no property. */
export function ownField(row: BinRow): string | null {
  return row.node === "property" ? fieldHash(row.path) : null;
}

interface ValueProps {
  value: BinValue;
  /** Where the row sits, which decides what the name cell already drew. */
  node: RowNode;
  /** The row's own key, which a value the projected read answers for reads its mark under. */
  rowKey: string;
  /** The field the value sits under, which its enum and its unit are keyed on. */
  field: string | null;
}

function Value({ value, node, rowKey: key, field }: ValueProps) {
  switch (value.type) {
    case "none":
      return <Dim>{m.workshop_bin_none_label()}</Dim>;
    case "bool":
      return <Checkbox size="sm" checked={value.value} readOnly tabIndex={-1} />;
    case "integer":
      return <IntegerValue text={value.text} field={field} />;
    case "float":
      return <NumberValue text={String(value.value)} field={field} />;
    case "vector":
      return <Components labels={AXES} values={value.values} width={COMPONENT_WIDTH} />;
    case "matrix":
      return <MatrixValue values={value.values} />;
    case "color":
      return <ColorValue value={value} />;
    case "string":
      return <StringValue text={value.value} />;
    case "hash":
      return <ObjectChip hash={value.hash} name={value.name} kind="hash" />;
    case "wadChunkLink":
      return <FileChip hash={value.hash} path={value.path} />;
    case "objectLink":
      return <ObjectChip hash={value.hash} name={value.name} kind="link" />;
    case "container":
      if (value.len === 0) return <Dim>{m.workshop_bin_empty_label()}</Dim>;
      return <Dim>{m.workshop_bin_items_label({ count: value.len })}</Dim>;
    case "map":
      if (value.len === 0) return <Dim>{m.workshop_bin_empty_label()}</Dim>;
      return <Dim>{m.workshop_bin_entries_label({ count: value.len })}</Dim>;
    case "struct":
      return <StructValue value={value} node={node} rowKey={key} />;
    case "null":
      return <Dim>{m.workshop_bin_null_label()}</Dim>;
    case "optional":
      if (value.present) return <Dim>{m.workshop_bin_present_label()}</Dim>;
      return <Dim>{m.workshop_bin_absent_label()}</Dim>;
    case "undrawn":
      return <Dim>{m.workshop_bin_undrawn_label()}</Dim>;
  }
}

/** An integer, drawn as the engine's own word for it wherever a table holds one. */
function IntegerValue({ text, field }: { text: string; field: string | null }) {
  const reading = enumReading(field, text);
  if (reading === null) return <NumberValue text={text} field={field} />;
  return <EnumValue reading={reading} raw={text} />;
}

/** A number in the box it is edited in, and the unit its field is measured in after it. */
function NumberValue({ text, field }: { text: string; field: string | null }) {
  const unit = fieldUnit(field);
  if (unit === null) return <Readout value={text} className={SCALAR_WIDTH} />;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Readout value={text} className={SCALAR_WIDTH} />
      <Unit unit={unit} />
    </span>
  );
}

/** A random range as the two boxes an edit sets, and the unit after them. */
function RangeValue({ range, field }: { range: ValueRange; field: string | null }) {
  const unit = fieldUnit(field);
  if (range.least === range.most) return <NumberValue text={String(range.least)} field={field} />;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Readout value={String(range.least)} className={COMPONENT_WIDTH} />
      <span className="shrink-0 text-surface-400 select-none">{RANGE_SEPARATOR}</span>
      <Readout value={String(range.most)} className={COMPONENT_WIDTH} />
      {unit !== null && <Unit unit={unit} />}
    </span>
  );
}

/** One range as the text of a cell too narrow for two boxes. */
function rangeText(range: ValueRange): string {
  if (range.least === range.most) return String(range.least);
  return `${range.least} ${RANGE_SEPARATOR} ${range.most}`;
}

/** What a number is measured in. "The inspector" in docs/ux/BIN_EDITOR.md. */
function Unit({ unit }: { unit: FieldUnit }) {
  return <span className="shrink-0 text-surface-400 select-none">{UNIT_SUFFIX[unit]()}</span>;
}

/** An enum in the box a leaf edit turns into a select, the number the file holds beside it. */
function EnumValue({ reading, raw }: { reading: string; raw: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        /* DS-VEIL, DS-RADIUS */
        className="flex min-w-0 items-center gap-1 rounded-sm border border-surface-veil bg-surface-veil-soft px-1.5 py-0.5 text-surface-200"
      >
        <span className="min-w-0 truncate select-text">{reading}</span>
        <CaretDownIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-400" />
      </span>
      {/* DS-CODE-CHIP */}
      <Code className="shrink-0 select-text">{raw}</Code>
    </span>
  );
}

/** The channel each axis is drawn in, X red, Y green and Z blue as Riot draws them. */
const AXIS_TINT: readonly string[] = [
  "text-channel-1-text",
  "text-channel-2-text",
  "text-channel-3-text",
  "text-channel-4-text",
];

/**
 * A vector down columns of one width, each axis tinted its own channel.
 *
 * "The inspector" in docs/ux/BIN_EDITOR.md. A component past the third wraps to a second
 * line of the same three columns, so one column holds one axis down the whole pane. An
 * axis a table widens reads its range.
 */
export function AxisCells({
  values,
  ranges,
}: {
  values: readonly (number | null)[];
  ranges?: readonly (ValueRange | null)[];
}) {
  return (
    <span className="grid min-w-0 flex-1 grid-cols-3 gap-1">
      {values.map((component, at) => (
        <span
          key={AXES[at] ?? at}
          /* DS-VEIL, DS-RADIUS */
          className="flex min-w-0 items-stretch overflow-hidden rounded-sm border border-surface-veil"
        >
          <span
            aria-hidden
            /* DS-WEIGHT-TIER */
            className={twMerge(
              "flex items-center bg-surface-veil px-1.5 font-mono font-semibold select-none",
              AXIS_TINT[at] ?? "text-surface-300",
            )}
          >
            {AXES[at] ?? at}
          </span>
          <span className="min-w-0 flex-1 truncate bg-surface-veil-soft px-1.5 py-0.5 text-right font-mono text-surface-200 tabular-nums select-text">
            {axisText(component, ranges?.[at])}
          </span>
        </span>
      ))}
    </span>
  );
}

/** One axis as its cell reads it: the range a table widens it to, else its value. */
function axisText(component: number | null, range: ValueRange | null | undefined): string {
  if (range == null) return String(component);
  return rangeText(range);
}

interface StructValueProps {
  value: Extract<BinValue, { type: "struct" }>;
  node: RowNode;
  rowKey: string;
}

function StructValue({ value, node, rowKey: key }: StructValueProps) {
  const mark = useValueMark(key);

  /* An element names its class beside its index, so the value column would write it twice. */
  if (node === "element") return <ValueMarkCell mark={mark} />;

  return (
    <>
      <ClassCard classHash={value.classHash} name={value.class} />
      <ValueMarkCell mark={mark} />
      {node === "object" && <span className="ml-auto text-meta text-surface-400">{value.len}</span>}
    </>
  );
}

/**
 * The constant a value-family row draws beside its class, once the read lands.
 *
 * "A value family on its row" in docs/ux/BIN_EDITOR.md. Nothing until it lands, which
 * keeps the row one line rather than a placeholder that shifts.
 */
export function ValueMarkCell({
  mark,
  axes = false,
  field = null,
}: {
  mark: ValueMark | undefined;
  /** A vector constant takes the inspector's tinted columns rather than a run of readouts. */
  axes?: boolean;
  /** The field the family sits under, whose unit a scalar constant carries. */
  field?: string | null;
}) {
  if (mark === undefined) return null;
  /* A colour that animates is drawn by its stops, which a file writing no constant still has. */
  if (mark.family === "color") {
    const rgba = channels(mark.constant);
    const stops = colorStops(mark.keys);
    if (rgba === null && stops.length === 0) return null;
    return <ColorMark constant={rgba} stops={stops} wide={axes} />;
  }
  const ranges = markRanges(mark);
  const [range] = ranges ?? [];
  if (mark.family === "scalar" && range != null) return <RangeValue range={range} field={field} />;
  if (mark.constant == null) return null;
  if (mark.constant.type === "float") {
    return <NumberValue text={String(mark.constant.value)} field={field} />;
  }
  if (mark.constant.type === "vector") {
    if (axes) return <AxisCells values={mark.constant.values} ranges={ranges ?? undefined} />;
    return <Components labels={AXES} values={mark.constant.values} width={COMPONENT_WIDTH} />;
  }
  return null;
}

interface ComponentsProps {
  labels: readonly string[];
  /** A component is `null` for a float JSON cannot carry: a NaN or an infinity. */
  values: readonly (number | null)[];
  /** The room one readout takes, so a column of rows lines up. */
  width: string;
}

function Components({ labels, values, width }: ComponentsProps) {
  return (
    <span className="flex min-w-0 gap-1.5">
      {values.map((component, at) => (
        <Readout
          key={labels[at] ?? at}
          value={String(component)}
          label={labels[at]}
          className={width}
        />
      ))}
    </span>
  );
}

/** Sixteen cells, shut until asked for. A shut matrix is one line like every other row. */
function MatrixValue({ values }: { values: readonly (number | null)[] }) {
  const [open, setOpen] = useState(false);
  const label = m.workshop_bin_matrix_label();

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setOpen((shown) => !shown);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-surface-400 hover:text-surface-200"
        onClick={toggle}
      >
        <CaretRightIcon weight="bold" className="h-3 w-3" />
        <span>{label}</span>
      </button>
    );
  }

  /* A cell is a control of its own, which nothing may nest inside a button. */
  return (
    <span className="my-1 flex items-start gap-1">
      <button
        type="button"
        aria-label={label}
        className="mt-1 flex h-4 w-3 shrink-0 cursor-pointer items-center justify-center text-surface-400 hover:text-surface-200"
        onClick={toggle}
      >
        <CaretRightIcon weight="bold" className="h-3 w-3 rotate-90" />
      </button>
      <span className="grid grid-cols-4 gap-x-1 gap-y-0.5">
        {values.map((cell, at) => (
          <Readout key={at} value={String(cell)} className={COMPONENT_WIDTH} />
        ))}
      </span>
    </span>
  );
}

function ColorValue({ value }: { value: Extract<BinValue, { type: "color" }> }) {
  const { r, g, b, a } = value;
  return (
    <span className="flex min-w-0 items-center gap-3">
      {/* DS-TOKEN */}
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-surface-veil-strong"
        style={{ backgroundColor: `rgba(${r}, ${g}, ${b}, ${a / 255})` }}
        aria-hidden
      />
      <Components labels={CHANNELS} values={[r, g, b, a]} width={CHANNEL_WIDTH} />
    </span>
  );
}

function Dim({ children }: { children: ReactNode }) {
  return <span className="text-surface-400">{children}</span>;
}
