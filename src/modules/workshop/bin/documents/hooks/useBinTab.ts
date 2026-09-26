import { useCallback, useEffect } from "react";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AssetRef, type BinDocumentId } from "@/lib/tauri";
import { type HistoryStep, useDocumentFlush, useDocumentHistory } from "@/modules/editor";

import { assetKey } from "../../../preview/utils/assetRef";
import { useOptionalProjectContext } from "../../../projects/state/ProjectContext";
import { queueForSave, saveBinNow, useBinSave, useWorkshopEditorStore } from "../../../state";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { announceReshape } from "../../tree/state/reshapes";
import { useDocumentCall } from "./useDocumentCall";

/**
 * What a bin tab offers the editor around it: its unsaved dot, its pending write, and its undo.
 *
 * "Save" and "Undo" in docs/ux/BIN_EDITOR.md. The dot follows `blocked` and `failed` alone,
 * a quit and `Ctrl+S` write the queued save, and the undo keys reach the tree from anywhere in
 * the group.
 */
export function useBinTab(
  documentId: string,
  document: BinDocumentId,
  asset: AssetRef,
  editable: boolean,
): void {
  const key = assetKey(asset);
  const save = useBinSave(key);
  const invalidate = useInvalidateBinReads();
  const call = useDocumentCall(document);
  const toast = useToast();

  const project = useOptionalProjectContext()?.path ?? null;
  const setDocumentDirty = useWorkshopEditorStore((store) => store.setDocumentDirty);
  const unsaved = editable && (save.state === "blocked" || save.state === "failed");
  useEffect(() => {
    if (project === null) return;

    setDocumentDirty(project, documentId, unsaved);
    return () => setDocumentDirty(project, documentId, false);
  }, [documentId, project, setDocumentDirty, unsaved]);

  useDocumentFlush(documentId, () => saveBinNow(key, document));

  const step = useCallback(
    (step: HistoryStep, target: Element | null) => {
      if (keepsKeystroke(target)) return false;

      const run = step === "undo" ? api.bin.undo : api.bin.redo;
      void call((id) => run(id)).then(({ result, id }) => {
        if (!result.ok) {
          const title =
            step === "undo"
              ? m.workshop_bin_undo_failed_title()
              : m.workshop_bin_redo_failed_title();
          toast.error(title, errorSummary(result.error));
          return;
        }
        if (result.value === null) return;

        queueForSave(key, id);
        invalidate();
        announceReshape(key, result.value);
      });
      return true;
    },
    [call, invalidate, key, toast],
  );
  useDocumentHistory(documentId, step, editable);
}

/**
 * Whether the element under an undo keystroke keeps it for its own text.
 *
 * A field holding a draft does, and so does any text field that is not a document value or
 * a line of the tree, such as a filter box.
 */
function keepsKeystroke(target: Element | null): boolean {
  if (target === null) return false;
  if (target.closest("[data-draft]") !== null) return true;

  const typing =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable);
  if (!typing) return false;

  return !target.hasAttribute("data-value-field") && target.closest('[role="treeitem"]') === null;
}
