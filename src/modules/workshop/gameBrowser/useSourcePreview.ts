import { useCallback } from "react";

import { previewDocument } from "../documents/contentDocument";
import { useOpenDocumentTab } from "../state";
import type { SourceFileNode } from "./sourceIndex";

/** What opening a game file row does, for either browser. */
export type OpenSourceFile = (node: SourceFileNode) => void;

/**
 * Open a game chunk in a preview document.
 *
 * The chunk carries the archive it came from, which is the only route back to
 * its bytes once the index has folded its archives into one tree. The resolved
 * path goes with it, since the reference itself holds only the hash.
 */
export function useSourcePreview(): OpenSourceFile {
  const openTab = useOpenDocumentTab();

  return useCallback(
    (node) =>
      openTab(
        previewDocument(
          { kind: "gameChunk", wad: node.entry.wad, pathHash: node.entry.pathHash },
          node.entry.path ?? undefined,
        ),
      ),
    [openTab],
  );
}
