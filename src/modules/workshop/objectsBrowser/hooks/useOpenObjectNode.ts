import { useCallback } from "react";

import type { ObjectDeclaration } from "@/lib/tauri";

import { type ContentDocument, objectDocument } from "../../documents/utils/contentDocument";
import type { OpenIntent } from "../../palette/utils/types";
import { useOpenDocumentAs, usePromoteDocument } from "../../state";
import type { ObjectTreeNode } from "../utils/objectTree";

/** The declaration an object row stands for: the first of the object's (ADR-0028). */
export function declarationOf(node: ObjectTreeNode): ObjectDeclaration | null {
  if (node.type === "object") return node.declarations[0] ?? null;
  return null;
}

/** The object tab of a row's first declaration, and null for a row that is not an object. */
export function objectNodeDocument(node: ObjectTreeNode): ContentDocument | null {
  if (node.type !== "object") return null;

  const declaration = declarationOf(node);
  if (!declaration) return null;

  return objectDocument(
    declaration.asset,
    node.objectHash,
    node.path,
    declaration.file,
    declaration.class,
  );
}

/**
 * Open the object tab a row stands for.
 *
 * An object row opens its first declaration. `permanent` pins the tab the way a double
 * click asks, which promotes a preview already open.
 */
export function useOpenObjectNode() {
  const open = useOpenDocumentAs();
  const promote = usePromoteDocument();

  return useCallback(
    (node: ObjectTreeNode, intent: OpenIntent) => {
      const document = objectNodeDocument(node);
      if (document === null) return;

      open(document, intent);
      if (intent === "permanent") promote(document.id);
    },
    [open, promote],
  );
}
