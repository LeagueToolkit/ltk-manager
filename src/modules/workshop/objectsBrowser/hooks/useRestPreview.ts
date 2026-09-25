import { type RefObject, useCallback, useEffect, useRef } from "react";

import { useOpenRowPreview, useRequestObjectsReveal } from "../../state";
import { objectPreviewKind } from "../utils/objectPreview";
import type { ObjectTreeNode } from "../utils/objectTree";
import { objectNodeDocument } from "./useOpenObjectNode";

/** How long the keyboard selection rests on a particle system before its preview tab opens. */
export const REST_PREVIEW_MS = 250;

/**
 * Open the preview tab of the particle system the keyboard selection rests on.
 *
 * Each call replaces the pending open, so only a node the selection rests on for
 * `REST_PREVIEW_MS` opens, and any other node cancels it. The open is a click's preview and
 * opens nothing while the preview setting is off. Focus is not moved. An open that splits
 * the browser's group remounts `host`, and the reveal puts focus back on the node.
 *
 * Per "What a row opens" in docs/ux/PROJECT_EDITOR.md.
 */
export function useRestPreview(
  host: RefObject<HTMLElement | null>,
): (node: ObjectTreeNode | undefined) => void {
  const previewRow = useOpenRowPreview();
  const reveal = useRequestObjectsReveal();
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback(
    (node) => {
      cancel();

      const document =
        node !== undefined && objectPreviewKind(node) === "vfx" ? objectNodeDocument(node) : null;
      if (node === undefined || document === null) return;

      timer.current = window.setTimeout(() => {
        timer.current = null;
        const element = host.current;
        previewRow(document);

        requestAnimationFrame(() => {
          if (element !== null && !element.isConnected) reveal(node.id);
        });
      }, REST_PREVIEW_MS);
    },
    [cancel, host, previewRow, reveal],
  );
}
