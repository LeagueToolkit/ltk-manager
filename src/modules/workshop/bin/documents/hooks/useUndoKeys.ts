import { type KeyboardEvent, useCallback } from "react";

import { api, type AssetRef, type BinDocumentId } from "@/lib/tauri";

import { assetKey } from "../../../preview/utils/assetRef";
import { queueForSave } from "../../../state";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { useDocumentCall } from "./useDocumentCall";

/**
 * The undo and redo keys of a tab over `document`, for its container's `onKeyDown`.
 *
 * "Undo" in docs/ux/BIN_EDITOR.md. A field holding a draft keeps the keystroke for its
 * own undo, and a field outside the rows is never the tree's.
 */
export function useUndoKeys(
  document: BinDocumentId,
  asset: AssetRef,
  editable: boolean,
): (event: KeyboardEvent<HTMLElement>) => void {
  const invalidate = useInvalidateBinReads();
  const call = useDocumentCall(document);
  const key = assetKey(asset);

  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const step = undoStep(event);
      if (!editable || step === null) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("[data-draft]")) return;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (typing && target.closest('[role="treeitem"]') === null) return;

      event.preventDefault();
      const run = step === "undo" ? api.bin.undo : api.bin.redo;
      void call((id) => run(id)).then(({ result, id }) => {
        if (!result.ok || !result.value) return;
        queueForSave(key, id);
        invalidate();
      });
    },
    [call, editable, invalidate, key],
  );
}

/** Which step a keystroke asks for: `Ctrl+Z` undoes, `Ctrl+Shift+Z` and `Ctrl+Y` redo. */
export function undoStep(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const letter = event.key.toLowerCase();
  if (letter === "z") return event.shiftKey ? "redo" : "undo";
  if (letter === "y" && !event.shiftKey) return "redo";
  return null;
}
