import { useToast } from "@/components";
import { errorMessage, m } from "@/i18n";
import { useKeys } from "@/modules/keys";

import { documentFind } from "./state/documentFinds";
import { documentHistory } from "./state/documentHistory";
import { documentSave } from "./state/documentSaves";

/** The ninth key is the last tab of the strip, whatever the count. */
const LAST_INDEX_KEY = 9;

export interface EditorKeysOptions {
  /** These keys answer for the focused group alone. */
  enabled: boolean;
  /** The group's strip, in its own order. */
  documentIds: readonly string[];
  activeId: string | null;
  onActivate: (id: string) => void;
  /** Closes one document, through the question a close with unsaved edits asks. */
  onClose: (id: string) => void;
  /** Where a find goes for a document with no search box of its own. */
  onFindElsewhere?: () => void;
  /** Puts the newest closed tab back. Absent leaves the key unbound. */
  onReopenClosed?: () => void;
}

/**
 * Answers the `editor.*` commands of one editor group: close, reopen, walk, take by index, save,
 * find and the history.
 *
 * Per "The editor's keys" in `docs/ux/PROJECT_EDITOR.md`. Bound by every group and answered by
 * the focused one, so a key reads the strip a reader is looking at rather than one it was handed.
 * The commands exclude an open dialog, menu or palette.
 */
export function useEditorKeys({
  enabled,
  documentIds,
  activeId,
  onActivate,
  onClose,
  onFindElsewhere,
  onReopenClosed,
}: EditorKeysOptions): void {
  const toast = useToast();

  /** The tab `delta` steps from the active one, wrapping at both ends. */
  function walk(delta: number) {
    if (documentIds.length === 0) return;

    const from = activeId === null ? 0 : Math.max(documentIds.indexOf(activeId), 0);
    const next = documentIds[(from + delta + documentIds.length) % documentIds.length];
    if (next !== undefined) onActivate(next);
  }

  function takeAt(position: number) {
    const index = position === LAST_INDEX_KEY ? documentIds.length - 1 : position - 1;
    const id = documentIds[index];
    if (id !== undefined) onActivate(id);
  }

  /* The digit the physical key reports, which is `Digit3` or `Numpad3`. */
  function takeByIndex(event: KeyboardEvent) {
    const digit = Number(event.code.replace(/^(Digit|Numpad)/, ""));
    if (Number.isInteger(digit)) takeAt(digit);
  }

  /** A document offering no write, a game archive among them, writes nothing. */
  function saveActive() {
    if (activeId === null) return;

    const write = documentSave(activeId);
    if (!write) return;

    void write().catch((error: unknown) => {
      toast.error(m.editor_save_failed_hint(), errorMessage(error));
    });
  }

  function findInActive() {
    const reveal = activeId === null ? null : documentFind(activeId);
    if (reveal) {
      reveal();
      return;
    }
    onFindElsewhere?.();
  }

  /* Declines the press unless the document takes the step, so a text field keeps its text undo. */
  function stepActive(step: "undo" | "redo", event: KeyboardEvent): boolean {
    if (activeId === null) return false;

    const history = documentHistory(activeId);
    if (history === null) return false;

    const target = event.target instanceof Element ? event.target : null;

    return history(step, target);
  }

  useKeys(
    "editor",
    {
      "editor.closeTab": () => activeId !== null && onClose(activeId),
      "editor.reopenTab": () => onReopenClosed?.(),
      "editor.nextTab": () => walk(1),
      "editor.previousTab": () => walk(-1),
      "editor.tabAt": takeByIndex,
      "editor.lastTab": () => takeAt(LAST_INDEX_KEY),
      "editor.save": saveActive,
      "editor.find": findInActive,
      "editor.undo": (event) => stepActive("undo", event),
      "editor.redo": (event) => stepActive("redo", event),
    },
    { enabled },
  );
}
