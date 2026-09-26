import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useState,
} from "react";

import { lineParent, type VisibleRow } from "../utils/binRows";

interface TreeNavigationOptions {
  visible: readonly VisibleRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollToKey: (key: string, align?: "start" | "auto") => boolean;
  /** Changes whenever the drawn window does, so a row scrolled into it can take focus. */
  drawn: unknown;
  toggle: (key: string) => void;
  /** Open the value of the row under `key` for an edit. Null where the tree takes none. */
  editValue: ((key: string) => void) | null;
}

export interface TreeNavigation {
  /** The one row a `Tab` into the tree lands on. */
  readonly tabStop: string | null;
  /** Answer a key on a focused row, answering whether the tree took it. */
  readonly keyDown: (event: ReactKeyboardEvent<HTMLElement>) => boolean;
  /** A row took focus, by pointer or by key. */
  readonly focused: (target: EventTarget) => void;
}

/** The row element under `target`, where `target` is a row itself rather than a field in one. */
function rowKeyOf(target: EventTarget): string | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.dataset.treeRow ?? null;
}

/**
 * The arrow keys of a tree's rows, the WAI-ARIA tree pattern over a virtualized list.
 *
 * `Up` and `Down` walk the rows, `Right` opens a row or steps into it, `Left` shuts it or steps
 * out to its parent, `Home` and `End` reach the ends. `Enter` and `F2` open a row's value for an
 * edit, and `Enter` on a row with nothing to edit opens or shuts it. One row is the tab stop.
 */
export function useTreeNavigation({
  visible,
  scrollRef,
  scrollToKey,
  drawn,
  toggle,
  editValue,
}: TreeNavigationOptions): TreeNavigation {
  const [current, setCurrent] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const rows = useMemo(
    () => visible.filter((line) => line.kind === "row").map((line) => line.key),
    [visible],
  );
  const tabStop = current !== null && rows.includes(current) ? current : (rows[0] ?? null);

  /* A row scrolled to draws a frame later, so focus waits for it to mount. */
  useEffect(() => {
    if (pending === null) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(
      `[data-tree-row="${CSS.escape(pending)}"]`,
    );
    if (row === null || row === undefined) return;

    row.focus({ preventScroll: true });
    setPending(null);
  }, [drawn, pending, scrollRef]);

  function moveTo(key: string | undefined) {
    if (key === undefined) return;
    setCurrent(key);
    setPending(key);
    scrollToKey(key, "auto");
  }

  function keyDown(event: ReactKeyboardEvent<HTMLElement>): boolean {
    const key = rowKeyOf(event.target);
    if (key === null || event.altKey || event.ctrlKey || event.metaKey) return false;

    const row = event.target as HTMLElement;
    const at = rows.indexOf(key);
    const expanded = row.getAttribute("aria-expanded");

    switch (event.key) {
      case "ArrowDown":
        moveTo(rows[at + 1]);
        return true;
      case "ArrowUp":
        moveTo(rows[at - 1]);
        return true;
      case "Home":
        moveTo(rows[0]);
        return true;
      case "End":
        moveTo(rows.at(-1));
        return true;
      case "ArrowRight":
        if (expanded === "false") toggle(key);
        if (expanded === "true") moveTo(rows[at + 1]);
        return true;
      case "ArrowLeft": {
        if (expanded === "true") {
          toggle(key);
          return true;
        }
        const line = visible.find((each) => each.key === key);
        const parent = line === undefined ? null : lineParent(line);
        if (parent !== null && rows.includes(parent)) moveTo(parent);
        return true;
      }
      case "Enter":
      case "F2": {
        const valued = row.querySelector("[data-row-value]") !== null;
        if (valued && editValue !== null) {
          editValue(key);
          return true;
        }
        if (event.key === "Enter" && expanded !== null) {
          toggle(key);
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  function focused(target: EventTarget) {
    const key = rowKeyOf(target);
    if (key !== null) setCurrent(key);
  }

  return { tabStop, keyDown, focused };
}
