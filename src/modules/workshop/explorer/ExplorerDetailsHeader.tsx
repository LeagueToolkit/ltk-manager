import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { m } from "@/i18n";
import type { ExplorerColumns } from "@/stores";
import { useExplorerColumns, useSetExplorerColumn } from "@/stores";
import { twMerge } from "@/utils";

import {
  COLUMN_MAX,
  COLUMN_MIN,
  DEFAULT_COLUMN_WIDTHS,
  type ExplorerColumn,
  resizedWidth,
} from "./columns";
import type { ExplorerSortField } from "./sort";

/** How far one arrow press moves a boundary. */
const KEY_STEP = 8;

/** Each column's heading, read at render because a message follows the locale. */
const HEADINGS: Readonly<Record<ExplorerColumn, () => string>> = {
  name: () => m.workshop_explorer_sort_name_label(),
  size: () => m.workshop_explorer_sort_size_label(),
  kind: () => m.workshop_explorer_sort_kind_label(),
};

export interface ExplorerDetailsHeaderProps {
  columns: readonly ExplorerColumn[];
  template: string;
  /** The header's own height in px, which the zoom has already been applied to. */
  height: number;
  sortField: ExplorerSortField;
  sortDescending: boolean;
  onSort: (field: ExplorerSortField) => void;
}

/**
 * The column headings, which sort and which the boundaries between them resize.
 *
 * Sticky inside the scroll rather than above it, so the header and the rows
 * measure against one width and a scrollbar cannot slide them apart.
 */
export function ExplorerDetailsHeader({
  columns,
  template,
  height,
  sortField,
  sortDescending,
  onSort,
}: ExplorerDetailsHeaderProps) {
  return (
    <div
      data-ui="ExplorerDetailsHeader"
      role="row"
      className="sticky top-0 z-10 grid border-b border-surface-700 bg-surface-900 text-meta text-surface-500 select-none"
      style={{ gridTemplateColumns: template, height: `${height}px` }}
    >
      {columns.map((column) => (
        <HeadingCell
          key={column}
          column={column}
          active={sortField === column}
          descending={sortDescending}
          onSort={onSort}
        />
      ))}
    </div>
  );
}

interface HeadingCellProps {
  column: ExplorerColumn;
  active: boolean;
  descending: boolean;
  onSort: (field: ExplorerSortField) => void;
}

function HeadingCell({ column, active, descending, onSort }: HeadingCellProps) {
  const Caret = descending ? CaretDownIcon : CaretUpIcon;

  return (
    <div role="columnheader" aria-sort={ariaSort(active, descending)} className="relative h-full">
      {column !== "name" && <Boundary column={column} />}
      <button
        type="button"
        onClick={() => onSort(column)}
        className={twMerge(
          "flex h-full w-full items-center gap-1 px-2 outline-none hover:bg-surface-veil",
          "focus-visible:ring-1 focus-visible:ring-accent-500 focus-visible:ring-inset",
          column !== "name" && "justify-end",
          active && "text-surface-300",
        )}
      >
        <span className="truncate">{HEADINGS[column]()}</span>
        {active && <Caret weight="bold" className="h-3 w-3 shrink-0" />}
      </button>
    </div>
  );
}

/** Where a drag started, which the move reads instead of the rendered width. */
interface Grab {
  x: number;
  width: number;
}

/**
 * The boundary on a fixed column's leading edge, which drags its width.
 *
 * The name takes whatever the fixed columns leave, so a fixed column's trailing
 * edge cannot move and the boundary is what follows the pointer: dragging it
 * towards the name widens the column to its right.
 */
function Boundary({ column }: { column: keyof ExplorerColumns }) {
  const widths = useExplorerColumns();
  const setWidth = useSetExplorerColumn();
  const grab = useRef<Grab | null>(null);
  const [dragging, setDragging] = useState(false);

  const resize = useCallback((width: number) => setWidth(column, width), [setWidth, column]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      /* Stops the drag from starting a text selection, and stops the header
         cell behind this from reading the press as a sort. */
      event.preventDefault();
      event.stopPropagation();
      grab.current = { x: event.clientX, width: widths[column] };
      setDragging(true);
    },
    [widths, column],
  );

  /* The window carries the drag rather than a pointer capture on this element.
     Writing a width re-renders the header, and a capture is one more thing that
     has to survive that for the boundary to keep following the pointer. */
  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      const from = grab.current;
      if (!from) return;
      resize(resizedWidth(from.width, from.x - event.clientX));
    };
    const stop = () => {
      grab.current = null;
      setDragging(false);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging, resize]);

  /* The pointer leaves the boundary long before the drag ends, so the cursor
     has to come from the document rather than from the element under it. */
  useEffect(() => {
    if (!dragging) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.cursor = previous;
    };
  }, [dragging]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      /* The rows behind this take the same keys to move the focus. */
      event.stopPropagation();
      event.preventDefault();
      resize(resizedWidth(widths[column], event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
    },
    [resize, widths, column],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={m.workshop_explorer_column_resize_action()}
      aria-valuenow={widths[column]}
      aria-valuemin={COLUMN_MIN}
      aria-valuemax={COLUMN_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        resize(DEFAULT_COLUMN_WIDTHS[column]);
      }}
      className="group/boundary absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
    >
      <span
        aria-hidden="true"
        className={twMerge(
          "absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-surface-600 transition-colors",
          "group-hover/boundary:inset-y-0 group-hover/boundary:w-0.5 group-hover/boundary:bg-accent-500",
          "group-focus-visible/boundary:inset-y-0 group-focus-visible/boundary:w-0.5 group-focus-visible/boundary:bg-accent-500",
          dragging && "inset-y-0 w-0.5 bg-accent-500",
        )}
      />
    </div>
  );
}

function ariaSort(active: boolean, descending: boolean): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return descending ? "descending" : "ascending";
}
