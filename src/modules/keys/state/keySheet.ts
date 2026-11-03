import { createDialogStore } from "@/stores";

import type { ScopeId } from "../utils/scopes";
import { activeScopes } from "./keyScopes";

/** The shortcut sheet, opened with the scopes that were active when it was asked for. */
export const useKeySheet = createDialogStore<readonly ScopeId[]>();

/** Opens the shortcut sheet with the scopes that the focused element reaches. */
export function openKeySheet(): void {
  const focused = document.activeElement;
  useKeySheet.getState().open(activeScopes(focused instanceof Node ? focused : null));
}
