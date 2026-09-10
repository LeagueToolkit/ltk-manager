import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";

import { useListNav } from "@/hooks/useListNav";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import { useZoomedPx } from "@/hooks/useZoomedPx";
import { twMerge } from "@/utils";

import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

/** A half-open run of characters to mark, as `[start, end)`. */
export type PaletteMatchRange = readonly [start: number, end: number];

export interface PaletteRow {
  id: string;
  /** The row's title, drawn bright. */
  name: string;
  nameRanges?: readonly PaletteMatchRange[];
  /** The dim second line. Absent draws a single-line row. */
  path?: string;
  pathRanges?: readonly PaletteMatchRange[];
  /** The trailing edge: where the row came from, or the key that runs it. */
  trailing?: string;
  icon?: ReactNode;
  /** Greys the row and stops it running. */
  disabled?: boolean;
}

export interface PaletteGroupModel {
  id: string;
  label: string;
  rows: readonly PaletteRow[];
  /** What matched in all, when the group shows fewer rows than it found. */
  total?: number;
  /**
   * An answer for this group is still on its way.
   *
   * A group that already holds rows keeps them, dimmed under a busy header, so
   * a source that has to be asked over IPC does not empty and refill under the
   * cursor at every keystroke. A group with none yet draws its rows as
   * placeholders, so a slow source reads as slow rather than as empty.
   */
  pending?: boolean;
}

/** Which modifiers were held when a row was chosen. */
export interface PaletteSelectModifiers {
  ctrlKey: boolean;
  altKey: boolean;
}

export interface CommandPaletteProps {
  query: string;
  onQueryChange: (query: string) => void;
  placeholder?: string;
  /** The chip before the caret, naming the source the query is scoped to. */
  scope?: string;
  /** Backspace on an empty query, and a click on the chip. */
  onScopeRemove?: () => void;
  /** `Tab` on the highlighted row, which scopes to that row's source. */
  onScopeTo?: (rowId: string) => void;
  groups: readonly PaletteGroupModel[];
  onSelect: (rowId: string, modifiers: PaletteSelectModifiers) => void;
  onClose: () => void;
  /** Shown in place of the list while nothing matched. */
  emptyMessage?: string;
  className?: string;
}

type PaletteItem =
  | { readonly kind: "header"; readonly group: PaletteGroupModel }
  | {
      readonly kind: "row";
      readonly row: PaletteRow;
      readonly position: number;
      /** The group is being replaced, so this row is the last answer, not this one. */
      readonly stale: boolean;
    }
  | { readonly kind: "skeleton"; readonly group: string; readonly at: number }
  | { readonly kind: "more"; readonly group: string; readonly rest: number };

const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 44;
const COMPACT_ROW_HEIGHT = 30;
const MORE_HEIGHT = 24;

/** How many placeholder rows stand in for a group that has none yet. */
const SKELETON_ROWS = 3;
/* Uneven, so the placeholders read as a list of names rather than as a block. */
const SKELETON_WIDTHS = [58, 44, 66];

/** Composes an identifier for a PaletteItem. */
function composeItemKey(item: PaletteItem): string {
  if (item.kind === "header") return `header:${item.group.id}`;
  if (item.kind === "row") return `row:${item.row.id}`;
  if (item.kind === "skeleton") return `skeleton:${item.group}:${item.at}`;
  return `more:${item.group}`;
}

function itemHeight(item: PaletteItem): number {
  if (item.kind === "header") return HEADER_HEIGHT;
  if (item.kind === "more") return MORE_HEIGHT;
  if (item.kind === "skeleton") return ROW_HEIGHT;
  return item.row.path === undefined ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
}

/**
 * A search box over grouped rows, in the shape an editor's quick open uses.
 *
 * Presentation and keyboard model alone. What the rows are, how they were
 * ranked, and what running one does all belong to the caller, which is what
 * lets the same box answer for files, for commands, and for whatever is added
 * to it later.
 *
 * The focus never leaves the input. The highlight travels through
 * `aria-activedescendant`, so the list can hold a window of its rows and each
 * one still says where it sits.
 */
export function CommandPalette({
  query,
  onQueryChange,
  placeholder,
  scope,
  onScopeRemove,
  onScopeTo,
  groups,
  onSelect,
  onClose,
  emptyMessage = "No matches",
  className,
}: CommandPaletteProps) {
  const listId = "command-palette-list";
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => flatten(groups), [groups]);
  const stops = useMemo(
    () =>
      items.flatMap((item, index) => (item.kind === "row" && !item.row.disabled ? [index] : [])),
    [items],
  );
  const optionCount = useMemo(
    () => items.reduce((total, item) => (item.kind === "row" ? total + 1 : total), 0),
    [items],
  );

  function run(index: number, modifiers: PaletteSelectModifiers) {
    const item = items[index];
    if (item?.kind === "row") onSelect(item.row.id, modifiers);
  }

  const { activeIndex, setActiveIndex, handleKeyDown } = useListNav({
    indices: stops,
    onSelect: (index, event) => run(index, { ctrlKey: event.ctrlKey, altKey: event.altKey }),
    onCancel: onClose,
  });

  const zoomed = useZoomedPx();
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => zoomed(itemHeight(items[index]!)),
    getItemKey: (index) => composeItemKey(items[index]!),
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const scrollToIndex = virtualizer.scrollToIndex;
  useEffect(() => {
    if (activeIndex !== null) scrollToIndex(activeIndex, { align: "auto" });
  }, [activeIndex, scrollToIndex]);

  const activeRowId = activeIndex === null ? undefined : `${listId}-row-${activeIndex}`;

  function handleInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && query.length === 0 && scope !== undefined) {
      event.preventDefault();
      onScopeRemove?.();
      return;
    }

    if (event.key === "Tab" && activeIndex !== null && onScopeTo) {
      const item = items[activeIndex];
      if (item?.kind === "row") {
        event.preventDefault();
        onScopeTo(item.row.id);
        return;
      }
    }

    handleKeyDown(event);
  }

  return (
    <div
      data-ui="CommandPalette"
      /* DS-GROUND: a surface floating over the fold sits at the popover rung. */
      className={twMerge(
        "flex max-h-[min(60vh,28rem)] flex-col overflow-hidden rounded-xl border border-surface-600 bg-surface-800 shadow-2xl select-none",
        className,
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 px-2.5">
        <MagnifyingGlassIcon weight="bold" className="h-4 w-4 shrink-0 text-surface-400" />

        {scope !== undefined && (
          <button
            type="button"
            onClick={onScopeRemove}
            className="shrink-0 cursor-pointer rounded-sm bg-accent-500/20 px-1.5 py-0.5 text-[0.6875rem] text-accent-200 transition-colors hover:bg-accent-500/30"
          >
            {scope}
          </button>
        )}

        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeRowId}
          aria-autocomplete="list"
          aria-label={placeholder ?? "Search"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-surface-50 select-text placeholder:text-surface-400 focus:outline-none"
        />
      </div>

      {items.length === 0 && (
        <div className="border-t border-surface-700 px-3 py-6 text-center text-sm text-surface-400">
          {emptyMessage}
        </div>
      )}

      {items.length > 0 && (
        <div
          ref={scrollRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto border-t border-surface-700 py-1"
          {...NO_OVERSCROLL}
        >
          <div
            role="presentation"
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.key}
                role="presentation"
                className="absolute inset-x-0 top-0"
                style={{
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <PaletteItemView
                  item={items[virtualItem.index]!}
                  id={`${listId}-row-${virtualItem.index}`}
                  active={virtualItem.index === activeIndex}
                  setSize={optionCount}
                  onHover={() => setActiveIndex(virtualItem.index)}
                  onRun={(modifiers) => run(virtualItem.index, modifiers)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PaletteItemViewProps {
  item: PaletteItem;
  id: string;
  active: boolean;
  /** How many options the whole list holds, which a windowed row cannot count. */
  setSize: number;
  onHover: () => void;
  onRun: (modifiers: PaletteSelectModifiers) => void;
}

function PaletteItemView({ item, id, active, setSize, onHover, onRun }: PaletteItemViewProps) {
  if (item.kind === "header") {
    const { group } = item;
    return (
      <div className="flex h-full items-center justify-between gap-2 px-3 text-[0.6875rem] font-medium tracking-wide text-surface-400 uppercase">
        <span className="truncate">{group.label}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {group.total !== undefined && !group.pending && (
            <span className="tabular-nums">{group.total}</span>
          )}
          {group.pending && <Spinner size="sm" className="h-3 w-3" />}
        </span>
      </div>
    );
  }

  if (item.kind === "skeleton") {
    return (
      <div className="flex h-full items-center gap-2.5 px-3">
        <Skeleton width={16} height={16} className="shrink-0 rounded-sm" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Two bars for the two lines a result row draws, at the widths a
              name and the path under it tend to take. */}
          <Skeleton width={`${SKELETON_WIDTHS[item.at % SKELETON_WIDTHS.length]}%`} height={9} />
          <Skeleton width="72%" height={7} className="opacity-60" />
        </div>
      </div>
    );
  }

  if (item.kind === "more") {
    return (
      <div className="flex h-full items-center pl-9 text-meta text-surface-500">
        and {item.rest} more…
      </div>
    );
  }

  const { row } = item;
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-setsize={setSize}
      aria-posinset={item.position}
      aria-disabled={row.disabled}
      onPointerMove={onHover}
      onClick={(event) => {
        if (!row.disabled) onRun({ ctrlKey: event.ctrlKey, altKey: event.altKey });
      }}
      className={twMerge(
        "mx-1 flex h-full cursor-pointer items-center gap-2.5 rounded-md px-2 transition-opacity",
        active && "bg-accent-500/15",
        /* Still the answer to the last query, so it stays clickable and only
           says that it is on its way out. */
        item.stale && "opacity-45",
        row.disabled && "cursor-default opacity-50",
      )}
    >
      {row.icon && <span className="flex w-4 shrink-0 justify-center">{row.icon}</span>}

      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={twMerge("truncate text-sm", active ? "text-accent-100" : "text-surface-100")}
        >
          <MarkedText text={row.name} ranges={row.nameRanges} />
        </span>
        {row.path !== undefined && (
          <span className="truncate font-mono text-meta text-surface-400">
            <MarkedText text={row.path} ranges={row.pathRanges} />
          </span>
        )}
      </div>

      {row.trailing && <span className="shrink-0 text-meta text-surface-400">{row.trailing}</span>}
    </div>
  );
}

export interface MarkedTextProps {
  text: string;
  ranges?: readonly PaletteMatchRange[];
}

/** The matched characters of a string, lifted out of the rest of it. */
export function MarkedText({ text, ranges }: MarkedTextProps) {
  if (!ranges || ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], index) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={index} className="bg-transparent font-medium text-accent-300">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** Headers, rows and the trailing count, in the one list the virtualizer walks. */
function flatten(groups: readonly PaletteGroupModel[]): PaletteItem[] {
  const items: PaletteItem[] = [];
  let position = 0;

  for (const group of groups) {
    const pending = group.pending === true;
    if (group.rows.length === 0 && !pending) continue;
    items.push({ kind: "header", group });

    if (group.rows.length === 0) {
      for (let at = 0; at < SKELETON_ROWS; at += 1)
        items.push({ kind: "skeleton", group: group.id, at });
      continue;
    }

    for (const row of group.rows) {
      position += 1;
      items.push({ kind: "row", row, position, stale: pending });
    }

    const rest = (group.total ?? group.rows.length) - group.rows.length;
    if (rest > 0) items.push({ kind: "more", group: group.id, rest });
  }
  return items;
}
