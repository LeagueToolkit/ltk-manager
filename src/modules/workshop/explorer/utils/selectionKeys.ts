import type { KeyboardEvent } from "react";

import { commandAt } from "@/modules/keys";

import type { ExplorerSelectionApi } from "../hooks/useExplorer";

/** How a keyboard extract runs: with no dialog, through the dialog, or as a copy into a layer. */
export type ExtractKeyHow = "quick" | "dialog" | "copy";

interface SelectionKeyTargets {
  /** The selection the keys act on. A view without one answers only the extract keys. */
  selection?: ExplorerSelectionApi;
  /** The selection id of the focused item, which `explorer.togglePick` toggles. */
  focusedId: string | null;
  onRun?: (how: ExtractKeyHow) => void;
}

/** The extract that each extract command of the explorer runs. */
const EXTRACTS: Readonly<Record<string, ExtractKeyHow>> = {
  "explorer.extract": "quick",
  "explorer.extractTo": "dialog",
  "explorer.copyToLayer": "copy",
};

/**
 * Runs the selection or extract command of `focus:explorer` that `event` asks for, and returns
 * whether one took it.
 */
export function handleSelectionKey(
  event: KeyboardEvent<HTMLElement>,
  { selection, focusedId, onRun }: SelectionKeyTargets,
): boolean {
  const command = commandAt(event, "focus:explorer");
  if (command === null) return false;

  const extract = EXTRACTS[command];
  if (onRun && extract !== undefined) {
    event.preventDefault();
    onRun(extract);
    return true;
  }
  if (!selection) return false;

  switch (command) {
    case "explorer.selectAll":
      event.preventDefault();
      selection.selectAll();
      return true;
    case "explorer.togglePick":
      event.preventDefault();
      if (focusedId !== null) selection.select(focusedId, { toggle: true, extend: false });
      return true;
    case "explorer.clearPicks":
      event.preventDefault();
      selection.clear();
      return true;
    default:
      return false;
  }
}
