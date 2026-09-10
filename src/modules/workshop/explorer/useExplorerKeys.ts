import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback } from "react";

import { type ExplorerView, useSetExplorerView } from "@/stores";

export interface UseExplorerKeysParams {
  onUp: () => void;
  /** Turns the breadcrumb into the typed path. */
  onType: () => void;
  /** The box the find and the filter share. */
  boxRef: RefObject<HTMLInputElement | null>;
}

/**
 * The keys that belong to the explorer rather than to whichever view is drawing.
 *
 * `Alt+←` stays with the navigation history. A move to a parent is not a move
 * back, so `Alt+↑` is its own key and never borrows that one.
 */
export function useExplorerKeys({
  onUp,
  onType,
  boxRef,
}: UseExplorerKeysParams): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const setView = useSetExplorerView();

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const key = event.key.toLowerCase();

      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        onUp();
        return;
      }

      if (!event.ctrlKey && !event.metaKey) {
        /* An input holds both of these as characters, so they only reach the
           explorer when the focus is on its rows. */
        if (holdsText(event.target)) return;

        if (key === "/") {
          event.preventDefault();
          boxRef.current?.focus();
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          onUp();
        }
        return;
      }

      if (key === "l") {
        event.preventDefault();
        onType();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        boxRef.current?.focus();
        return;
      }

      const view = VIEW_KEYS[key];
      if (view) {
        event.preventDefault();
        setView(view);
      }
    },
    [onUp, onType, boxRef, setView],
  );
}

const VIEW_KEYS: Readonly<Record<string, ExplorerView | undefined>> = {
  "1": "tree",
  "2": "grid",
  "3": "details",
};

function holdsText(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.matches("input, textarea, [contenteditable]");
}
