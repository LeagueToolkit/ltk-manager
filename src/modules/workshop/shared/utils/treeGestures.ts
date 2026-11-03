import { isChord, type KeyPress, shortcutOf } from "@/modules/keys";

/** The collapse-all chord as a tooltip draws it, after VS Code's `list.collapseAll`. */
export const COLLAPSE_ALL_SHORTCUT = shortcutOf("tree.collapseAll");

/** Returns `true` if a key press on a focused tree is `tree.collapseAll`. */
export function isCollapseAllKey(event: KeyPress): boolean {
  return isChord(event, "tree.collapseAll");
}

/** Whether a chevron click asks for the whole subtree rather than one level: Alt, Shift or Ctrl. */
export function isSubtreeClick(
  event: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | undefined,
): boolean {
  if (!event) return false;

  return event.altKey || event.shiftKey || event.ctrlKey || event.metaKey;
}
