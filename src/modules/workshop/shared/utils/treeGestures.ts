/** The collapse-all combo as a tooltip draws it, after VS Code's `list.collapseAll`. */
export const COLLAPSE_ALL_SHORTCUT = "Ctrl+←";

/** Whether a key press on a focused tree asks it to shut every folder. */
export function isCollapseAllKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (
    event.key === "ArrowLeft" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

/** Whether a chevron click asks for the whole subtree rather than one level: Alt, Shift or Ctrl. */
export function isSubtreeClick(
  event: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean } | undefined,
): boolean {
  if (!event) return false;

  return event.altKey || event.shiftKey || event.ctrlKey || event.metaKey;
}
