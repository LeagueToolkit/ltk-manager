import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useState } from "react";
import { twMerge } from "tailwind-merge";

import { Checkbox, Readout, SeverityGlyph, Tooltip } from "@/components";
import { errorSummary, m } from "@/i18n";
import type { AppError, BinRow, BinValue, RowNode } from "@/lib/tauri";

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
import { rowTag } from "./kindTag";
import { FileChip, ObjectChip, StringValue } from "./LinkChip";
import { useValueMark } from "./useValueMarks";
import { channels, type ValueMark } from "./valueRows";

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
        /* DS-VEIL, DS-RADIUS */
        "group/row flex min-h-6 items-center gap-2 rounded-sm pr-2 text-mono-row transition-colors duration-100 hover:bg-surface-veil",
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
    "truncate",
    object ? "font-medium text-surface-100" : "text-surface-200",
    element && "text-surface-400",
    row.unnamed && "text-surface-300",
  );

  return (
    <span
      className={twMerge(
        "flex min-w-0 shrink-0 items-center gap-1.5",
        object ? "max-w-[60%]" : "w-[calc(var(--bin-name-cols)*1ch+2rem)]",
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
      <Value value={row.value} node={row.node} rowKey={rowKey(row)} />
    </span>
  );
}

interface ValueProps {
  value: BinValue;
  /** Where the row sits, which decides what the name cell already drew. */
  node: RowNode;
  /** The row's own key, which a value the projected read answers for reads its mark under. */
  rowKey: string;
}

function Value({ value, node, rowKey: key }: ValueProps) {
  switch (value.type) {
    case "none":
      return <Dim>{m.workshop_bin_none_label()}</Dim>;
    case "bool":
      return <Checkbox size="sm" checked={value.value} readOnly tabIndex={-1} />;
    case "integer":
      return <Readout value={value.text} className={SCALAR_WIDTH} />;
    case "float":
      return <Readout value={String(value.value)} className={SCALAR_WIDTH} />;
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

interface StructValueProps {
  value: Extract<BinValue, { type: "struct" }>;
  node: RowNode;
  rowKey: string;
}

function StructValue({ value, node, rowKey: key }: StructValueProps) {
  const mark = useValueMark(key);

  /* An element names its class beside its index, so the value column would write it twice. */
  if (node === "element") {
    return (
      <>
        {mark === undefined && <Dim>{m.workshop_bin_properties_label({ count: value.len })}</Dim>}
        <ValueMarkCell mark={mark} />
      </>
    );
  }

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
function ValueMarkCell({ mark }: { mark: ValueMark | undefined }) {
  if (mark?.constant == null) return null;
  if (mark.family === "color") {
    const rgba = channels(mark.constant);
    if (rgba === null) return null;
    return <ColorMark constant={rgba} stops={mark.stops} />;
  }
  if (mark.constant.type === "float") {
    return <Readout value={String(mark.constant.value)} className={SCALAR_WIDTH} />;
  }
  if (mark.constant.type === "vector") {
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
