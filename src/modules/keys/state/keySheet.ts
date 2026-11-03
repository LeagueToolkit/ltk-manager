import { createDialogStore } from "@/stores/createDialogStore";

import type { ScopeId } from "../utils/scopes";
import { activeScopes } from "./keyScopes";

/** The shortcut sheet, opened with the scopes that were active when it was asked for. */
export const useKeySheet = createDialogStore<readonly ScopeId[]>();

/**
 * Opens the shortcut sheet with the scopes that `from` reaches, which defaults to the focused
 * element.
 *
 * A menu item passes the element of the view it serves, since the menu holds the focus while it
 * runs.
 */
export function openKeySheet(from: Node | null = document.activeElement): void {
  useKeySheet.getState().open(activeScopes(from));
}
