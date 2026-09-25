import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  type Icon,
  PencilSimpleIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  Checkbox,
  Code,
  Readout,
  Select,
  SeverityGlyph,
  Tooltip,
  InputDefaultContext,
} from "@/components";
import { errorSummary, m } from "@/i18n";
import type { AppError, BinRow, BinValue, RowNode } from "@/lib/tauri";
import { twMerge } from "@/utils";

import type { OpenIntent } from "../../../palette/utils/types";
import { ObjectGlyph } from "../../../shared/components/ObjectGlyph";
import { clickIntent } from "../../../state";
import { ClassCard } from "../../classes/components/ClassCard";
import { DeclaredLine, FieldCard } from "../../classes/components/FieldCard";
import {
  DeclaredDiagnosticsMark,
  DeclaredRowMark,
  ObjectChangeMark,
} from "../../documents/components/DeclaredLayer";
import {
  useDeclaredMark,
  useDeclaredObject,
  useDeclares,
  useRowDiagnostics,
} from "../../documents/hooks/useDeclared";
import { FileChip, ObjectChip, StringValue } from "../../links/components/LinkChip";
import { ObjectNameContext, useObjectOpen } from "../../links/hooks/useLinkTargets";
import { PathInput } from "../../paths/components/PathInput";
import { type PathField, pathFieldOf } from "../../paths/utils/pathField";
import { CutText } from "../../shared/components/CutText";
import { ColorMark } from "../../values/components/ColorMark";
import { useValueMark } from "../../values/hooks/useValueMarks";
import { enumReading, enumText, type FieldEnum, fieldEnum } from "../../values/utils/fieldEnums";
import { type FieldUnit, fieldUnit, UNIT_SUFFIX } from "../../values/utils/fieldUnits";
import { rowTag } from "../../values/utils/kindTag";
import {
  channels,
  colorStops,
  markRanges,
  type ValueMark,
  type ValueRange,
} from "../../values/utils/valueRows";
import { BinEditContext, useRowEdit } from "../hooks/useBinEdit";
import { type LeafEdit, LeafEditContext } from "../hooks/useLeafEdit";
import { useGuideLevels } from "../state/treeGuides";
import { typedKey } from "../utils/addItem";
import {
  canExpand,
  fieldHash,
  guideBlocks,
  INDENT,
  lineParent,
  MAX_INDENT_DEPTH,
  outsideColumn,
  recordField,
  repeatsKey,
  rowKey,
  type RowLine,
  type VisibleRow,
} from "../utils/binRows";
import {
  boolLeaf,
  colorLeaf,
  floatLeaf,
  hashedLeaf,
  integerLeaf,
  matrixLeaf,
  stringLeaf,
  vectorLeaf,
} from "../utils/leafText";
import {
  EDIT_ICON,
  editLabel,
  keyEdit,
  onHover,
  type RowEdit,
  rowEdits,
  undeclarable,
} from "../utils/rowEdits";

/**
 * One line at zoom 100, which is what sizes the virtualizer. A matrix opened in place grows past it.
 *
 * `min-h-6` is six spacing units of 4.5px. An estimate off the drawn height moves every row
 * below a row as it measures.
 */
export const ROW_HEIGHT = 27;

const AXES = ["x", "y", "z", "w"] as const;
const CHANNELS = ["r", "g", "b", "a"] as const;

/** The room a number on its own takes, so a column of rows lines its digits up. */
const SCALAR_WIDTH = "w-[var(--bin-scalar-width,8rem)]";

/** One component of a vector or a matrix, which holds a float. */
const COMPONENT_WIDTH = "w-[var(--bin-component-width,6rem)]";

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

const NO_EDITS: readonly RowEdit[] = [];

/** What focus lands on in a row an edit sent it to: the value's first control, else an action. */
const FOCUS_TARGET =
  "[data-row-value] input:not([readonly]), [data-row-value] button, [data-row-action]";

/** One node of the bin: its name, its kind as a tag, and its value. */
export function BinRowLine({ line, focused, error, onToggle, onOpenObject }: RowLineProps) {
  const { row, depth, expanded, loading } = line;
  const edit = use(BinEditContext);
  /* An object the chosen layer removes draws as its row alone: nothing under it, no edit. */
  const removed = useDeclaredObject(objectEntry(row))?.change === "removed";
  const expandable = !removed && canExpand(row, edit !== null);
  const declares = useDeclares();
  const edits = edit === null || removed ? NO_EDITS : rowEdits(line);
  const rowRef = useRef<HTMLDivElement>(null);
  const focusHere = edit !== null && edit.focusKey === line.key;

  /* A row drawn before the request keeps its fields mounted, so autoFocus alone misses it. */
  useEffect(() => {
    if (!focusHere) return;
    const drawn = rowRef.current;
    if (drawn !== null && !drawn.contains(document.activeElement)) {
      drawn.querySelector<HTMLElement>(FOCUS_TARGET)?.focus();
    }
    edit.settleFocus();
  }, [edit, focusHere]);

  function keys(event: ReactKeyboardEvent<HTMLDivElement>) {
    const asked = edit === null ? null : keyEdit(event, edits);
    if (asked === null) return;
    event.preventDefault();
    event.stopPropagation();
    edit?.run(line, asked);
  }

  return (
    <div
      ref={rowRef}
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
      onKeyDown={keys}
    >
      <NameCell line={line} expandable={expandable} expanded={expanded} loading={loading} />
      {row.value.type === "records" ? (
        <span className="shrink-0 text-meta text-surface-400">{row.value.len}</span>
      ) : (
        <RowValue row={row} />
      )}
      {error && (
        <Tooltip content={errorSummary(error)}>
          <WarningCircleIcon className="h-3.5 w-3.5 shrink-0 text-warning-text" />
        </Tooltip>
      )}
      {edit !== null &&
        edits
          .filter(onHover)
          /* A refused edit states its reason in the menu, where a label has room. */
          .filter((kind) => !declares || undeclarable(kind, row) === null)
          .map((kind) => (
            <RowAction
              key={kind}
              label={editLabel(kind)}
              icon={EDIT_ICON[kind]}
              onAct={() => edit.run(line, kind)}
            />
          ))}
      {row.node === "object" && onOpenObject && !removed && (
        <OpenObjectAction onOpen={(intent) => onOpenObject(row, intent)} />
      )}
      {row.node === "target" && <OpenTargetAction hash={row.entry} />}
    </div>
  );
}

interface RowActionProps {
  label: string;
  icon: Icon;
  onAct: () => void;
}

/** A hover action of an editable row, which leaves the row's own click alone. */
export function RowAction({ label, icon: Glyph, onAct }: RowActionProps) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        data-row-action
        /* DS-VEIL, DS-RADIUS */
        className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 opacity-0 group-hover/row:opacity-100 hover:bg-surface-veil hover:text-surface-200 focus-visible:opacity-100"
        onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
          event.stopPropagation();
          onAct();
        }}
      >
        <Glyph weight="bold" className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
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

/** A patch target row's hover action, opening the object the records patch where one declares it. */
function OpenTargetAction({ hash }: { hash: string }) {
  const open = useObjectOpen(hash);
  if (open === null) return null;
  return <OpenObjectAction onOpen={open} />;
}

interface MoreRowProps {
  line: Extract<VisibleRow, { kind: "more" }>;
}

/** The line under a node whose rows have not all answered. */
export function MoreRow({ line }: MoreRowProps) {
  return (
    <div className="flex h-6 items-center gap-2 pr-2 text-meta text-surface-400">
      <Guides depth={line.depth} parent={lineParent(line)} />
      <span className="w-3 shrink-0" />
      <SpinnerGapIcon className="h-3 w-3 animate-spin" />
      <span>{m.workshop_bin_more_label({ loaded: line.loaded, total: line.total })}</span>
    </div>
  );
}

interface GuidesProps {
  depth: number;
  /** The key of the row the line hangs under. Null at depth zero. */
  parent: string | null;
}

/**
 * One guide per open level, each under the caret of the level it belongs to.
 *
 * A guide runs the line's full height, so a block's guides join into one edge. The block
 * the reader stands in takes the accent, and the block under the pointer lifts a rung.
 */
export function Guides({ depth, parent }: GuidesProps) {
  const blocks = useMemo(() => guideBlocks(parent, depth), [parent, depth]);
  const { active, hover } = useGuideLevels(blocks);
  const indented = Math.min(depth, MAX_INDENT_DEPTH);
  const tone = (level: number) =>
    twMerge(
      "shrink-0 border-l border-surface-700/60",
      level === hover && "border-surface-600",
      level === active && "border-accent-500",
      level >= indented && "w-0.5",
    );
  return (
    <span className="flex shrink-0 translate-x-[6px] self-stretch" aria-hidden>
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          className={tone(level)}
          style={level < indented ? { width: INDENT } : undefined}
        />
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
  const { edit, refusal } = useRowEdit(line.key);
  const declared = useDeclaredMark(line.key);
  const objectChange = useDeclaredObject(objectEntry(row));
  const reported = useRowDiagnostics(line.key);
  /* A target is an object of another file, drawn as the heading its records sit under. */
  const target = row.node === "target";
  const object = row.node === "object" || target;
  const property = row.node === "property";
  const element = row.node === "element";
  const rekeyable = edit !== null && row.node === "entry";
  const held = element && row.value.type === "struct" ? row.value : null;
  const nameClasses = twMerge(
    /* An element's index is what a reader counts rows by, so the class beside it elides first. */
    element ? "shrink-0" : "truncate",
    object ? "font-medium text-surface-100" : "text-surface-200",
    element && "text-surface-400",
    row.unnamed && "text-surface-300",
    objectChange?.change === "removed" && "text-surface-400 line-through",
  );

  return (
    <span
      className={twMerge(
        "flex min-w-0 shrink-0 items-center gap-1.5 self-stretch",
        /* An element sits outside the column: its value follows its index rather than
           starting where a property's value does. */
        /* A target draws no class after its path, so the path takes the line and cuts in its
           middle, where the paths of one patch share their folders. */
        target && "min-w-0 flex-1",
        !target && outsideColumn(row.node) && "max-w-[60%]",
        !outsideColumn(row.node) && "w-[min(calc(var(--bin-name-cols)*1ch+2rem),50%)]",
      )}
    >
      <Guides depth={depth} parent={lineParent(line)} />
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
      {rekeyable && (
        <TextEdit
          text={typedKey(row.name)}
          label={m.workshop_bin_edit_key_action()}
          invalid={refusal !== undefined}
          autoFocus={false}
          onCommit={(text) => edit.setKey(line, text)}
        >
          <span className={nameClasses}>{row.name}</span>
        </TextEdit>
      )}
      {target && <CutText text={row.name} className={nameClasses} />}
      {!property && !rekeyable && !target && <span className={nameClasses}>{row.name}</span>}
      {repeatsKey(row) && (
        <Tooltip content={m.workshop_bin_repeated_key_hint()}>
          <WarningCircleIcon
            aria-label={m.workshop_bin_repeated_key_hint()}
            className="h-3.5 w-3.5 shrink-0 text-warning-text"
          />
        </Tooltip>
      )}
      {declared && <DeclaredRowMark mark={declared.mark} layer={declared.layer} />}
      {objectChange && <ObjectChangeMark change={objectChange.change} layer={objectChange.layer} />}
      <DeclaredDiagnosticsMark diagnostics={reported} />
      {held && <ClassCard classHash={held.classHash} name={held.class} />}
      {!object && !element && <KindTag row={row} />}
    </span>
  );
}

/** The entry an object row stands for, and none for any other row. */
function objectEntry(row: BinRow): string {
  return row.node === "object" ? row.entry : "";
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
export function RowValue({ row, field = ownField(row) }: { row: BinRow; field?: string | null }) {
  const objectName = use(ObjectNameContext);
  const key = rowKey(row);
  const { edit: treeEdit } = useRowEdit(key);
  const leafEdit = use(LeafEditContext);
  const edit = treeEdit ?? leafEdit;
  const refusal = edit?.refused.get(key);
  const focused = treeEdit !== null && treeEdit.focusKey === key;
  const widget =
    edit === null
      ? null
      : leafField(row, edit, {
          field,
          invalid: refusal !== undefined,
          object: objectName(row.entry),
          autoFocus: focused,
          onEnter: () => treeEdit?.enter(key),
        });

  if (widget !== null) {
    return (
      <span data-row-value className="flex min-w-0 flex-1 items-center gap-2">
        {widget}
        {refusal !== undefined && (
          <Tooltip content={errorSummary(refusal)}>
            <WarningCircleIcon className="h-3.5 w-3.5 shrink-0 text-danger-text" />
          </Tooltip>
        )}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Value
        value={row.value}
        node={row.node}
        rowKey={rowKey(row)}
        field={field}
        object={objectName(row.entry)}
      />
    </span>
  );
}

interface LeafDrawing {
  field: string | null;
  /** The last value the row sent was refused. */
  invalid: boolean;
  /** The path of the object the row sits in. */
  object: string;
  /** Focus the field as it draws, for a value just added. */
  autoFocus: boolean;
  /** A bare `Enter` left the field. */
  onEnter: () => void;
}

/**
 * The widget a leaf takes an edit in, or null for a value an edit does not reach here.
 *
 * "Leaf editing" in docs/ux/BIN_EDITOR.md. A plain function rather than a component, so
 * the caller falls back to the read-only value on null.
 */
function leafField(row: BinRow, edit: LeafEdit, drawn: LeafDrawing): ReactNode | null {
  const { field, invalid, object, autoFocus, onEnter } = drawn;
  const { value } = row;
  switch (value.type) {
    case "bool":
      return (
        <Checkbox
          size="sm"
          checked={value.value}
          onCheckedChange={(checked) => edit.commit(row, boolLeaf(checked))}
        />
      );
    case "integer": {
      const held = field === null ? null : fieldEnum(field);
      if (held !== null && !held.flags) {
        return (
          <EnumSelect
            held={held}
            text={value.text}
            onChange={(text) => edit.commit(row, integerLeaf(text))}
          />
        );
      }
      const reading = enumReading(field, value.text);
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          <NumberValue
            text={value.text}
            step="integer"
            field={field}
            invalid={invalid}
            autoFocus={autoFocus}
            onEnter={onEnter}
            onCommit={(text) => edit.commit(row, integerLeaf(text))}
          />
          {reading !== null && <Dim>{reading}</Dim>}
        </span>
      );
    }
    case "float":
      return (
        <NumberValue
          text={String(value.value)}
          field={field}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(text) => edit.commit(row, floatLeaf(text))}
        />
      );
    case "vector":
      return (
        <Components
          labels={AXES}
          values={value.values}
          width={COMPONENT_WIDTH}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(at, text) => edit.commit(row, vectorLeaf(value.values, at, text))}
        />
      );
    case "color":
      return (
        <ColorValue
          value={value}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(at, text) => edit.commit(row, colorLeaf(value, at, text))}
        />
      );
    case "matrix":
      return (
        <MatrixValue
          values={value.values}
          invalid={invalid}
          onCommit={(at, text) => edit.commit(row, matrixLeaf(value.values, at, text))}
        />
      );
    case "string":
      return (
        <TextEdit
          text={value.value}
          path={pathFieldOf(row)}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(text) => edit.commit(row, stringLeaf(text))}
        >
          <StringValue text={value.value} />
        </TextEdit>
      );
    case "hash":
    case "objectLink":
      return (
        <TextEdit
          text={value.name ?? value.hash}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(text) => edit.commit(row, hashedLeaf(value.type, text))}
        >
          <ObjectChip
            hash={value.hash}
            name={value.name}
            kind={value.type === "hash" ? "hash" : "link"}
            base={object}
            classMark="after"
          />
        </TextEdit>
      );
    case "wadChunkLink":
      return (
        <TextEdit
          text={value.path ?? value.hash}
          path={pathFieldOf(row)}
          invalid={invalid}
          autoFocus={autoFocus}
          onEnter={onEnter}
          onCommit={(text) => edit.commit(row, hashedLeaf("wadChunkLink", text))}
        >
          <FileChip hash={value.hash} path={value.path} />
        </TextEdit>
      );
    default:
      return null;
  }
}

interface TextEditProps {
  /** The text the field opens holding: the string, the name, or the hex. */
  text: string;
  /** What the edit action is called. The value's edit where absent. */
  label?: string;
  /** The path field settings, for a field that suggests files. Null for a plain text field. */
  path?: PathField | null;
  invalid: boolean;
  /** Open the field as the row draws, for a property just added. */
  autoFocus: boolean;
  onEnter?: () => void;
  onCommit: (text: string) => void;
  /** What the row draws while no edit is open. */
  children: ReactNode;
}

/**
 * A value drawn as its chip or its text, opening to a field on the row's edit action.
 *
 * The chip stays what a reader reads and clicks, so a string naming a file still opens
 * it. The field is for the change.
 */
function TextEdit({
  text,
  label = m.workshop_bin_edit_value_action(),
  path = null,
  invalid,
  autoFocus,
  onEnter,
  onCommit,
  children,
}: TextEditProps) {
  const implicit = use(InputDefaultContext);
  const [editing, setEditing] = useState(autoFocus);
  if ((editing || implicit) && path !== null) {
    return (
      <PathInput
        value={text}
        field={path}
        placeholder={text || m.workshop_bin_empty_label()}
        aria-label={label}
        invalid={invalid}
        autoFocus={editing}
        onEnter={onEnter}
        onCommit={onCommit}
        onLeave={() => setEditing(false)}
      />
    );
  }
  if (editing || implicit) {
    return (
      <Readout
        value={text}
        placeholder={text || m.workshop_bin_empty_label()}
        aria-label={label}
        className="min-w-0 flex-1"
        invalid={invalid}
        autoFocus={editing}
        onEnter={onEnter}
        onCommit={onCommit}
        onLeave={() => setEditing(false)}
      />
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {children}
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={label}
          /* DS-VEIL, DS-RADIUS */
          className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 opacity-0 group-hover/row:opacity-100 hover:bg-surface-veil hover:text-surface-200 focus-visible:opacity-100"
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
            event.stopPropagation();
            setEditing(true);
          }}
        >
          <PencilSimpleIcon weight="bold" className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}

interface EnumSelectProps {
  held: FieldEnum;
  /** The number the file holds, as text. */
  text: string;
  onChange: (text: string) => void;
}

/** An enum as a select of the engine's words, the number the file holds beside it. */
function EnumSelect({ held, text, onChange }: EnumSelectProps) {
  const implicit = use(InputDefaultContext);
  const options = Object.values(held.names).map((value) => String(value));
  if (!options.includes(text)) options.unshift(text);
  const labelOf = (option: string) => enumText(held, Number(option)) ?? option;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Select.Root
        value={implicit ? null : text}
        onValueChange={(next) => next !== null && (implicit || next !== text) && onChange(next)}
      >
        <Select.Trigger
          /* DS-VEIL, DS-RADIUS */
          className={twMerge(
            "h-auto w-auto min-w-0 gap-1 rounded-sm border-surface-veil bg-surface-veil-soft px-1.5 py-0.5 text-mono-row text-surface-200",
            implicit && "border-dashed bg-transparent text-surface-400",
          )}
          onClick={(event: ReactMouseEvent<HTMLButtonElement>) => event.stopPropagation()}
        >
          <Select.Value>{(current: string | null) => labelOf(current ?? text)}</Select.Value>
          <CaretDownIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-400" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup>
              {options.map((option) => (
                <Select.Item key={option} value={option}>
                  {labelOf(option)}
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {/* DS-CODE-CHIP */}
      <Code
        className={twMerge("shrink-0 select-text", implicit && "bg-transparent text-surface-400")}
      >
        {text}
      </Code>
    </span>
  );
}

/**
 * The field hash a row's own tables are keyed on, and null for a row that is no property.
 *
 * A patch record counts as the property its path ends in.
 */
export function ownField(row: BinRow): string | null {
  if (row.node === "property") return fieldHash(row.path);
  if (row.node === "record") return recordField(row.name);
  return null;
}

interface ValueProps {
  value: BinValue;
  /** Where the row sits, which decides what the name cell already drew. */
  node: RowNode;
  /** The row's own key, which a value the projected read answers for reads its mark under. */
  rowKey: string;
  /** The field the value sits under, which its enum and its unit are keyed on. */
  field: string | null;
  /** The path of the object the row sits in, which a link's path reads under. */
  object: string;
}

function Value({ value, node, rowKey: key, field, object }: ValueProps) {
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
    case "objectLink":
      return (
        <ObjectChip
          hash={value.hash}
          name={value.name}
          kind={value.type === "hash" ? "hash" : "link"}
          base={object}
          classMark="after"
        />
      );
    case "wadChunkLink":
      return <FileChip hash={value.hash} path={value.path} />;
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
    case "records":
      return <span className="ml-auto text-meta text-surface-400">{value.len}</span>;
  }
}

/** An integer, drawn as the engine's own word for it wherever a table holds one. */
function IntegerValue({ text, field }: { text: string; field: string | null }) {
  const reading = enumReading(field, text);
  if (reading === null) return <NumberValue text={text} field={field} />;
  return <EnumValue reading={reading} raw={text} />;
}

interface NumberValueProps {
  step?: number | "integer";
  text: string;
  field: string | null;
  invalid?: boolean;
  /** Focus the box as it draws. */
  autoFocus?: boolean;
  /** A bare `Enter` left the box. */
  onEnter?: () => void;
  /** Take an edit. Absent, the box is read-only. */
  onCommit?: (text: string) => void;
}

/** A number in the box it is edited in, and the unit its field is measured in after it. */
function NumberValue({
  text,
  field,
  invalid,
  autoFocus,
  onEnter,
  onCommit,
  step = 1,
}: NumberValueProps) {
  const unit = fieldUnit(field);
  const box = (
    <Readout
      value={text}
      step={step}
      className={SCALAR_WIDTH}
      invalid={invalid}
      autoFocus={autoFocus}
      onEnter={onEnter}
      onCommit={onCommit}
    />
  );
  if (unit === null) return box;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {box}
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
  invalid?: boolean;
  /** Focus the first box as it draws. */
  autoFocus?: boolean;
  /** A bare `Enter` left a box. */
  onEnter?: () => void;
  /** Take an edit to the component at `at`. Absent, the boxes are read-only. */
  onCommit?: (at: number, text: string) => void;
}

function Components({
  labels,
  values,
  width,
  invalid,
  autoFocus,
  onEnter,
  onCommit,
}: ComponentsProps) {
  return (
    <span className="flex min-w-0 gap-1.5">
      {values.map((component, at) => (
        <Readout
          key={labels[at] ?? at}
          value={String(component)}
          step={labels === CHANNELS ? "integer" : 1}
          label={labels[at]}
          labelClassName={AXIS_TINT[at]}
          className={width}
          invalid={invalid}
          autoFocus={autoFocus === true && at === 0}
          onEnter={onEnter}
          onCommit={onCommit && ((text) => onCommit(at, text))}
        />
      ))}
    </span>
  );
}

interface MatrixValueProps {
  values: readonly (number | null)[];
  invalid?: boolean;
  /** Take an edit to the cell at `at`, row-major. Absent, the cells are read-only. */
  onCommit?: (at: number, text: string) => void;
}

/** Sixteen cells, shut until asked for. A shut matrix is one line like every other row. */
function MatrixValue({ values, invalid, onCommit }: MatrixValueProps) {
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
          <Readout
            key={at}
            value={String(cell)}
            step={0.1}
            className={COMPONENT_WIDTH}
            invalid={invalid}
            onCommit={onCommit && ((text) => onCommit(at, text))}
          />
        ))}
      </span>
    </span>
  );
}

interface ColorValueProps {
  value: Extract<BinValue, { type: "color" }>;
  invalid?: boolean;
  autoFocus?: boolean;
  onEnter?: () => void;
  /** Take an edit to the channel at `at`, in `rgba` order. Absent, the boxes are read-only. */
  onCommit?: (at: number, text: string) => void;
}

function ColorValue({ value, invalid, autoFocus, onEnter, onCommit }: ColorValueProps) {
  const { r, g, b, a } = value;
  return (
    <span className="flex min-w-0 items-center gap-3">
      {/* DS-TOKEN */}
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-surface-veil-strong"
        style={{ backgroundColor: `rgba(${r}, ${g}, ${b}, ${a / 255})` }}
        aria-hidden
      />
      <Components
        labels={CHANNELS}
        values={[r, g, b, a]}
        width={CHANNEL_WIDTH}
        invalid={invalid}
        autoFocus={autoFocus}
        onEnter={onEnter}
        onCommit={onCommit}
      />
    </span>
  );
}

function Dim({ children }: { children: ReactNode }) {
  return <span className="text-surface-400">{children}</span>;
}
