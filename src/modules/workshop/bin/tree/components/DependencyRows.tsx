import {
  ArrowCounterClockwiseIcon,
  CaretRightIcon,
  LinkSimpleIcon,
  MinusCircleIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  use,
  useEffect,
  useRef,
  useState,
} from "react";

import { errorSummary, m } from "@/i18n";
import type { AppError } from "@/lib/tauri";
import { twMerge } from "@/utils";
import type { Result } from "@/utils/result";

import { LinkChangeMark } from "../../documents/components/DeclaredLayer";
import { DependencyChip } from "../../links/components/LinkChip";
import { useChunkOpen } from "../../links/hooks/useLinkTargets";
import { BinEditContext, type DependencyEdit } from "../hooks/useBinEdit";
import { useDependencyAbilities, useSendDependencyEdit } from "../hooks/useDependencyRow";
import { DependencyEditingContext } from "../state/dependencyEditing";
import { type AddLine, lineParent, type VisibleRow } from "../utils/binRows";
import { AddLineFrame, LINE_FIELD_CLASSES } from "./AddLineFrame";
import { Guides, RowAction } from "./BinRow";

type DependenciesLine = Extract<VisibleRow, { kind: "dependencies" }>;

/** One dependency's line of the tree. */
export type DependencyLine = Extract<VisibleRow, { kind: "dependency" }>;

/** The drag type a dependency row carries, its index as the data. */
const DRAG_TYPE = "application/x-ltk-dependency";

/**
 * Focus another line of the pinned list: the dependency at `index`, the add line past the
 * last, or the pinned row itself before the first.
 */
function focusLine(from: HTMLElement, index: number) {
  const selector =
    index < 0
      ? "[data-dependencies-row]"
      : `[data-dependency-index="${index}"], [data-dependency-add] input`;
  from.closest('[role="tree"]')?.querySelector<HTMLElement>(selector)?.focus();
}

interface DependenciesRowProps {
  line: DependenciesLine;
  onToggle: (key: string) => void;
}

/**
 * The row pinned over a file's objects that the header's dependencies fold under, with their
 * count. "Dependencies" in docs/ux/BIN_EDITOR.md.
 */
export function DependenciesRow({ line, onToggle }: DependenciesRowProps) {
  function keys(event: ReactKeyboardEvent<HTMLDivElement>) {
    const opens = event.key === "ArrowRight" && !line.expanded;
    const closes = event.key === "ArrowLeft" && line.expanded;
    if (event.key === "Enter" || event.key === " " || opens || closes) {
      event.preventDefault();
      onToggle(line.key);
    } else if (event.key === "ArrowDown" && line.expanded) {
      event.preventDefault();
      focusLine(event.currentTarget, 0);
    }
  }

  return (
    <div
      data-ui="BinDocument:dependencies"
      data-dependencies-row
      role="treeitem"
      aria-level={1}
      aria-expanded={line.expanded}
      tabIndex={0}
      /* DS-VEIL, DS-RADIUS */
      className="group/row flex min-h-6 cursor-pointer items-center gap-2 rounded-sm pr-2 text-mono-row outline-none hover:bg-surface-veil-soft focus-visible:bg-surface-veil"
      onClick={() => onToggle(line.key)}
      onKeyDown={keys}
    >
      <span className="flex min-w-0 items-center gap-1.5 self-stretch">
        <Guides depth={0} parent={null} />
        <span className="flex h-4 w-3 shrink-0 items-center justify-center text-surface-400">
          <CaretRightIcon
            weight="bold"
            className={twMerge("h-3 w-3", line.expanded && "rotate-90")}
          />
        </span>
        <LinkSimpleIcon className="h-3.5 w-3.5 shrink-0 text-surface-400" />
        <span className="truncate font-medium text-surface-100">
          {m.workshop_bin_dependencies_title()}
        </span>
      </span>
      <span className="shrink-0 text-meta text-surface-400">{line.count}</span>
    </div>
  );
}

interface DependencyRowProps {
  line: DependencyLine;
}

/**
 * One dependency: the chip a `file` link to it draws, its declared mark, and its edits.
 *
 * The chip reads the brex spelling where one folds the path, and opens and names the path
 * itself. Enter opens, F2 edits, Delete removes, `Alt+Up` and `Alt+Down` move, and a drag
 * onto another row moves it there. A declared document adds and removes only, and a
 * dependency its layer removes stays struck through with Restore (ADR-0050).
 */
export function DependencyRow({ line }: DependencyRowProps) {
  const { dependency, index, count } = line;
  const { path } = dependency;
  const label = dependency.packed ?? path;
  const { edit, refusal, removed, layer } = useDependencyAbilities(path);
  const editing = use(DependencyEditingContext);
  const open = useChunkOpen(path);
  const send = useSendDependencyEdit();
  const [dropping, setDropping] = useState(false);

  const reorders = edit !== null && refusal === null && !removed;
  const isEditing = editing.index === index && reorders;

  function move(to: number, from = index) {
    if (edit === null || to < 0 || to >= count || to === from) return;
    send(edit.move(from, to));
  }

  function keys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (event.key === "Enter" && plain && open !== null) {
      event.preventDefault();
      open("default");
    } else if (event.key === "F2" && plain && reorders) {
      event.preventDefault();
      editing.start(index);
    } else if (event.key === "Delete" && plain && edit !== null && !removed) {
      event.preventDefault();
      send(edit.remove(index));
    } else if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      if (reorders) move(index + (event.key === "ArrowUp" ? -1 : 1));
    } else if (plain && event.key === "ArrowUp") {
      event.preventDefault();
      focusLine(event.currentTarget, index - 1);
    } else if (plain && event.key === "ArrowDown") {
      event.preventDefault();
      focusLine(event.currentTarget, index + 1);
    }
  }

  function dragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!reorders || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropping(true);
  }

  function drop(event: ReactDragEvent<HTMLDivElement>) {
    setDropping(false);
    const from = Number(event.dataTransfer.getData(DRAG_TYPE));
    if (!reorders || !Number.isInteger(from)) return;
    event.preventDefault();
    move(index, from);
  }

  return (
    <div
      data-ui="BinDocument:dependency"
      data-dependency-index={index}
      role="treeitem"
      aria-level={2}
      aria-label={path}
      tabIndex={0}
      draggable={reorders && !isEditing}
      className={twMerge(
        /* DS-VEIL, DS-RADIUS */
        "group/row flex min-h-6 items-center gap-2 rounded-sm pr-2 text-mono-row outline-none hover:bg-surface-veil-soft focus-visible:bg-surface-veil",
        dropping && "bg-accent-500/15",
      )}
      onKeyDown={keys}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(index));
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={dragOver}
      onDragLeave={() => setDropping(false)}
      onDrop={drop}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch">
        <Guides depth={line.depth} parent={lineParent(line)} />
        <span className="w-3 shrink-0" />
        {isEditing && edit !== null && (
          <PathField
            path={path}
            onCommit={(text) => edit.set(index, text)}
            onClose={() => editing.start(null)}
          />
        )}
        {!isEditing && removed && (
          <span title={path} className="min-w-0 truncate text-surface-400 line-through select-text">
            {label}
          </span>
        )}
        {!isEditing && !removed && <DependencyChip path={path} label={label} />}
        {layer !== null && <LinkChangeMark change={removed ? "removed" : "added"} layer={layer} />}
      </span>
      {edit !== null && !isEditing && removed && (
        <RowAction
          label={m.workshop_bin_dependency_restore_action()}
          icon={ArrowCounterClockwiseIcon}
          onAct={() => send(edit.restore(path))}
        />
      )}
      {edit !== null && !isEditing && !removed && (
        <>
          {reorders && (
            <RowAction
              label={m.workshop_bin_dependency_edit_action()}
              icon={PencilSimpleIcon}
              onAct={() => editing.start(index)}
            />
          )}
          <RowAction
            label={m.workshop_bin_dependency_remove_action()}
            icon={MinusCircleIcon}
            onAct={() => send(edit.remove(index))}
          />
        </>
      )}
    </div>
  );
}

interface PathFieldProps {
  /** The full path, which the field starts on even where the row reads its brex spelling. */
  path: string;
  onCommit: (text: string) => Promise<Result<unknown>>;
  onClose: () => void;
}

/** The path of a dependency edited in place. Enter or leaving sends it, Escape backs out. */
function PathField({ path, onCommit, onClose }: PathFieldProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(path);
  const [error, setError] = useState<AppError | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    const input = ref.current;
    input?.focus();
    input?.select();
  }, []);

  async function commit() {
    if (settled.current) return;
    if (text.trim() === path) {
      settled.current = true;
      onClose();
      return;
    }
    const result = await onCommit(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    settled.current = true;
    onClose();
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <input
        ref={ref}
        type="text"
        value={text}
        data-draft={text !== path || undefined}
        aria-label={m.workshop_bin_dependency_path_label()}
        aria-invalid={error !== null || undefined}
        spellCheck={false}
        autoComplete="off"
        className={twMerge(LINE_FIELD_CLASSES, "max-w-2xl", error !== null && "border-danger")}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            void commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            settled.current = true;
            onClose();
          }
        }}
        onBlur={() => {
          if (error === null) void commit();
        }}
      />
      {error !== null && (
        <span role="alert" className="min-w-0 truncate text-meta text-danger-text">
          {errorSummary(error)}
        </span>
      )}
    </span>
  );
}

interface DependencyAddLineProps {
  line: AddLine;
  autoFocus: boolean;
}

/**
 * The line closing the dependency list, where a new one is typed as a path or its brex
 * spelling. Enter adds it at the end and keeps the line for the next, Escape clears it.
 */
export function DependencyAddLine({ line, autoFocus }: DependencyAddLineProps) {
  const edit = use(BinEditContext)?.dependencies ?? null;
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  if (edit === null) return null;

  async function add(dependencies: DependencyEdit) {
    if (pending || text.trim() === "") return;
    setPending(true);
    const result = await dependencies.add(text);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setText("");
    setError(null);
  }

  return (
    <AddLineFrame line={line} pending={pending} error={null}>
      <span data-dependency-add className="flex min-w-0 flex-1 items-center gap-2">
        <input
          ref={ref}
          type="text"
          value={text}
          data-draft={text !== "" || undefined}
          aria-label={m.workshop_bin_dependency_add_label()}
          placeholder={m.workshop_bin_dependency_add_placeholder()}
          aria-invalid={error !== null || undefined}
          spellCheck={false}
          autoComplete="off"
          className={twMerge(LINE_FIELD_CLASSES, "max-w-2xl", error !== null && "border-danger")}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void add(edit);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setText("");
              setError(null);
            }
            if (event.key === "ArrowUp" && text === "") {
              event.preventDefault();
              const rows = event.currentTarget
                .closest('[role="tree"]')
                ?.querySelectorAll<HTMLElement>("[data-dependency-index]");
              const last = rows?.[rows.length - 1];
              if (last) last.focus();
              else focusLine(event.currentTarget, -1);
            }
          }}
        />
        {error !== null && (
          <span role="alert" className="min-w-0 truncate text-meta text-danger-text">
            {errorSummary(error)}
          </span>
        )}
      </span>
    </AddLineFrame>
  );
}
