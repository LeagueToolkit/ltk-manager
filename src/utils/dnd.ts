import type { Modifier } from "@dnd-kit/core";

/**
 * Lock a drag to the vertical axis, for a list that reorders top to bottom.
 *
 * A sortable list resolves a drop by index, so sideways travel changes nothing
 * and only lets the row wander off its own column.
 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Lock a drag to the horizontal axis, for a strip that reorders left to right. */
export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });
