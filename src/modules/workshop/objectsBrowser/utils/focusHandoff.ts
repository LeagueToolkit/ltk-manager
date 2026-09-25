/** How many frames a restore waits for the marked element to draw before it stops. */
const RESTORE_FRAMES = 120;

/**
 * A focused element found again in another tab of the shell it was in.
 *
 * The element's tag, class, role and tab index, and its place among the elements of the
 * tab that match all four.
 */
export interface FocusMark {
  readonly tag: string;
  readonly className: string;
  readonly role: string | null;
  readonly tabIndex: string | null;
  readonly ordinal: number;
}

function fitsMark(element: Element, mark: FocusMark): boolean {
  return (
    (element.getAttribute("class") ?? "") === mark.className &&
    element.getAttribute("role") === mark.role &&
    element.getAttribute("tabindex") === mark.tabIndex
  );
}

function markedIn(root: HTMLElement, mark: FocusMark): Element[] {
  return [...root.getElementsByTagName(mark.tag)].filter((element) => fitsMark(element, mark));
}

/** The mark of `focused` inside `root`, and null when focus is on `root` or outside it. */
export function focusMark(root: HTMLElement, focused: Element | null): FocusMark | null {
  if (focused === null || focused === root || !root.contains(focused)) return null;

  const mark: FocusMark = {
    tag: focused.tagName,
    className: focused.getAttribute("class") ?? "",
    role: focused.getAttribute("role"),
    tabIndex: focused.getAttribute("tabindex"),
    ordinal: 0,
  };
  return { ...mark, ordinal: Math.max(0, markedIn(root, mark).indexOf(focused)) };
}

/** The element `mark` names inside `root`, and null while `root` has not drawn it. */
export function findMarked(root: HTMLElement, mark: FocusMark): HTMLElement | null {
  const found = markedIn(root, mark)[mark.ordinal];
  return found instanceof HTMLElement ? found : null;
}

/**
 * Focus the element `mark` names in `root` once `root` draws it.
 *
 * The wait stops after `RESTORE_FRAMES`, or once focus is on an element outside `root`,
 * since the reader has put it somewhere else. Focus the tab gives itself meanwhile is
 * replaced by the marked element. A null mark leaves focus to the tab. Returns what cancels
 * the wait.
 */
export function restoreFocus(root: HTMLElement, mark: FocusMark | null): () => void {
  if (mark === null) return () => {};

  let frames = RESTORE_FRAMES;
  let handle = 0;
  const attempt = () => {
    const active = document.activeElement;
    if (active !== null && active !== document.body && !root.contains(active)) return;

    const target = findMarked(root, mark);
    if (target !== null) {
      target.focus({ preventScroll: true });
      return;
    }

    frames -= 1;
    if (frames > 0) handle = requestAnimationFrame(attempt);
  };

  attempt();
  return () => cancelAnimationFrame(handle);
}
