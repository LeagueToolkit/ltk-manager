/**
 * The columns a details list draws, and the one template every row shares.
 *
 * Per "The details list" in docs/ux/PROJECT_EDITOR.md, the header row and every
 * data row take one `grid-template-columns`, so a resize moves both or neither.
 */

export type ExplorerColumn = "name" | "size" | "kind";

/** The fixed columns, in px. The name takes whatever they leave. */
export interface ColumnWidths {
  readonly size: number;
  readonly kind: number;
}

export const DEFAULT_COLUMN_WIDTHS: ColumnWidths = { size: 88, kind: 112 };

/** Narrow enough to crowd a heading, and wide enough to squeeze out the name. */
export const COLUMN_MIN = 56;
export const COLUMN_MAX = 280;

/** The pane width under which the list reads as a name and a size alone. */
export const KIND_DROP_WIDTH = 640;

const WIDE: readonly ExplorerColumn[] = ["name", "size", "kind"];
const NARROW: readonly ExplorerColumn[] = ["name", "size"];

/**
 * The columns a pane of this width has the room for.
 *
 * A width of zero is a pane a `ResizeObserver` has not reported yet, and it
 * reads as wide so the header does not flash a column into place.
 */
export function visibleColumns(paneWidth: number): readonly ExplorerColumn[] {
  if (paneWidth === 0) return WIDE;
  return paneWidth >= KIND_DROP_WIDTH ? WIDE : NARROW;
}

/** The `grid-template-columns` of the header row and of every data row. */
export function columnTemplate(columns: readonly ExplorerColumn[], widths: ColumnWidths): string {
  const fixed = columns
    .filter((column): column is keyof ColumnWidths => column !== "name")
    .map((column) => `${Math.round(widths[column])}px`);

  return ["minmax(0, 1fr)", ...fixed].join(" ");
}

/** Where a divider drag leaves the column it started on. */
export function resizedWidth(startWidth: number, delta: number): number {
  return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(startWidth + delta)));
}
