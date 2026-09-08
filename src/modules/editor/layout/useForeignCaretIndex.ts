import { useDndContext } from "@dnd-kit/core";

import { decodeDroppableId } from "./dnd";

/**
 * Where a tab dragged in from another strip would land, or null.
 *
 * A reorder within the strip previews through the sortable transforms instead,
 * so the caret only answers a foreign drag: before the hovered tab, or at the
 * end for a drop on the leaf's centre.
 */
export function useForeignCaretIndex(leafId: string, ids: readonly string[]): number | null {
  const { active, over } = useDndContext();
  const dragged = active ? decodeDroppableId(String(active.id)) : null;
  if (dragged?.kind !== "tab" || dragged.leafId === leafId) return null;

  const target = over ? decodeDroppableId(String(over.id)) : null;
  if (!target || target.leafId !== leafId) return null;

  if (target.kind === "tab") {
    const index = ids.indexOf(target.documentId);
    return index < 0 ? null : index;
  }
  return target.region === "center" ? ids.length : null;
}
