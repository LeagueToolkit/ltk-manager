/**
 * Hand the keyboard to the first row of the visible tree inside `body`.
 *
 * A browser can keep a second tree mounted under `hidden` - the browse tree
 * during a search - so the visible one is the tree whose rows take focus. The
 * tree itself takes it where no row is rendered yet.
 */
export function focusRows(body: HTMLElement | null) {
  if (!body) return;

  const rows = body.querySelectorAll<HTMLElement>('[data-tree-rows] [data-treeitem-index="0"]');
  const first = [...rows].find((row) => row.offsetParent !== null);
  if (first) {
    first.focus();
    return;
  }
  const trees = body.querySelectorAll<HTMLElement>('[role="tree"]');
  [...trees].find((tree) => tree.offsetParent !== null)?.focus();
}
