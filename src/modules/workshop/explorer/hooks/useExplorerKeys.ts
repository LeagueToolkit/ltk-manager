import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback } from "react";

import { commandAt, typesText } from "@/modules/keys";
import { type ExplorerView, useSetExplorerView } from "@/stores";

export interface UseExplorerKeysParams {
  onUp: () => void;
  /** Turns the breadcrumb into the typed path. */
  onType: () => void;
  /** The box the find and the filter share. */
  boxRef: RefObject<HTMLInputElement | null>;
}

const VIEWS: Readonly<Record<string, ExplorerView | undefined>> = {
  "explorer.viewTree": "tree",
  "explorer.viewGrid": "grid",
  "explorer.viewDetails": "details",
};

/**
 * Returns the handler of the `focus:explorer` commands that belong to the explorer rather than to
 * whichever view is drawing.
 *
 * `Alt+Left` stays with the navigation history. A move to a parent is not a move back, so
 * `explorer.up` is its own key and never borrows that one. A taken press stops here, so the app's
 * commands on the same chords stay out of it.
 */
export function useExplorerKeys({
  onUp,
  onType,
  boxRef,
}: UseExplorerKeysParams): (event: ReactKeyboardEvent<HTMLElement>) => void {
  const setView = useSetExplorerView();

  return useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      const command = commandAt(event, "focus:explorer");
      const view = command === null ? undefined : VIEWS[command];
      /* An input holds `/` and Backspace as characters. */
      const typed = command === "explorer.parent" || event.key === "/";
      if (typed && typesText(event.target)) return;

      const run = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };

      if (command === "explorer.up" || command === "explorer.parent") run(onUp);
      else if (command === "explorer.find") run(() => boxRef.current?.focus());
      else if (command === "explorer.typePath") run(onType);
      else if (view !== undefined) run(() => setView(view));
    },
    [onUp, onType, boxRef, setView],
  );
}
