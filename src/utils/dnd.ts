import type { Modifier } from "@dnd-kit/core";

/**
 * Lock a drag to the vertical axis, for a list that reorders top to bottom.
 *
 * A sortable list resolves a drop by index, so sideways travel changes nothing
 * and only lets the row wander off its own column.
 */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
