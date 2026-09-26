import { useHotkeys } from "react-hotkeys-hook";

import { useToast } from "@/components";
import { errorMessage, m } from "@/i18n";
import { isOverlayOpen } from "@/utils";

import { documentFind } from "./state/documentFinds";
import { documentHistory } from "./state/documentHistory";
import { documentSave } from "./state/documentSaves";

/** Every key an editor group answers is held while a field has the caret. */
const OPTIONS = { preventDefault: true, enableOnFormTags: true } as const;

/* The palette draws as a combobox rather than a dialog, so `isOverlayOpen` does
   not see it. */
function paletteHasCaret(): boolean {
  const focused = document.activeElement;
  return focused instanceof Element && focused.closest('[role="combobox"]') !== null;
}

/** Whether something over the editor owns the keyboard: a dialog, a menu, the palette. */
function claimed(): boolean {
  return isOverlayOpen() || paletteHasCaret();
}

/* `Alt` rather than `Ctrl`, which the routes hold: "The editor's keys" in
   `docs/ux/PROJECT_EDITOR.md`. */
const BY_INDEX = "alt+1, alt+2, alt+3, alt+4, alt+5, alt+6, alt+7, alt+8, alt+9";

/** Undo, and the two redo spellings Windows and the web both use. */
const HISTORY_KEYS = "ctrl+z, ctrl+shift+z, ctrl+y, meta+z, meta+shift+z";

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
 * The keys one editor group answers: close, reopen, walk, take by index, save, find.
 *
 * Per "The editor's keys" in `docs/ux/PROJECT_EDITOR.md`. Bound by every group
 * and answered by the focused one, so a key reads the strip a reader is looking
 * at rather than one it was handed.
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
    if (claimed() || documentIds.length === 0) return;

    const from = activeId === null ? 0 : Math.max(documentIds.indexOf(activeId), 0);
    const next = documentIds[(from + delta + documentIds.length) % documentIds.length];
    if (next !== undefined) onActivate(next);
  }

  function takeByIndex(event: KeyboardEvent) {
    if (claimed() || documentIds.length === 0) return;

    /* The digit the physical key reports, which is `Digit3` or `Numpad3`. */
    const digit = Number(event.code.replace(/^(Digit|Numpad)/, ""));
    if (!Number.isInteger(digit)) return;

    const index = digit === LAST_INDEX_KEY ? documentIds.length - 1 : digit - 1;
    const id = documentIds[index];
    if (id !== undefined) onActivate(id);
  }

  function closeActive() {
    if (claimed() || activeId === null) return;
    onClose(activeId);
  }

  /** A document offering no write, a game archive among them, writes nothing. */
  function saveActive() {
    if (claimed() || activeId === null) return;

    const write = documentSave(activeId);
    if (!write) return;

    void write().catch((error: unknown) => {
      toast.error(m.editor_save_failed_hint(), errorMessage(error));
    });
  }

  function findInActive() {
    if (claimed()) return;

    const reveal = activeId === null ? null : documentFind(activeId);
    if (reveal) {
      reveal();
      return;
    }
    onFindElsewhere?.();
  }

  function reopenClosed() {
    if (claimed()) return;
    onReopenClosed?.();
  }

  /* Default left to the field unless the document takes the step, so a text field keeps its text undo. */
  function stepActive(event: KeyboardEvent) {
    if (claimed() || activeId === null) return;

    const history = documentHistory(activeId);
    if (history === null) return;

    const step = event.code === "KeyY" || event.shiftKey ? "redo" : "undo";
    const target = event.target instanceof Element ? event.target : null;
    if (history(step, target)) event.preventDefault();
  }

  useHotkeys("ctrl+w", closeActive, { ...OPTIONS, enabled }, [enabled, activeId, onClose]);
  useHotkeys("ctrl+shift+t", reopenClosed, { ...OPTIONS, enabled }, [enabled, onReopenClosed]);
  useHotkeys("ctrl+tab, ctrl+pagedown", () => walk(1), { ...OPTIONS, enabled }, [
    enabled,
    documentIds,
    activeId,
    onActivate,
  ]);
  useHotkeys("ctrl+shift+tab, ctrl+pageup", () => walk(-1), { ...OPTIONS, enabled }, [
    enabled,
    documentIds,
    activeId,
    onActivate,
  ]);
  useHotkeys(BY_INDEX, takeByIndex, { ...OPTIONS, enabled }, [enabled, documentIds, onActivate]);
  useHotkeys("ctrl+s", saveActive, { ...OPTIONS, enabled }, [enabled, activeId, toast]);
  useHotkeys("ctrl+f", findInActive, { ...OPTIONS, enabled }, [enabled, activeId, onFindElsewhere]);
  useHotkeys(HISTORY_KEYS, stepActive, { ...OPTIONS, preventDefault: false, enabled }, [
    enabled,
    activeId,
  ]);
}
