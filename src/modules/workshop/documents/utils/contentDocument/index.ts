import type { AssetDoc } from "./asset";
import type { GameBrowserDoc } from "./game";
import type { ProjectDoc } from "./project";

export * from "./asset";
export * from "./game";
export * from "./project";

/**
 * Something the content editor can open: a document over the project and its
 * layers, a browser over the installed game, or one asset or object.
 */
export type ContentDocument = ProjectDoc | GameBrowserDoc | AssetDoc;

/** One kind of content document, for an editor that only handles that kind. */
export type ContentDocumentOf<K extends ContentDocument["kind"]> = Extract<
  ContentDocument,
  { kind: K }
>;

/** The layer a document edits, or null for the ones that belong to no layer. */
export function documentLayerName(document: ContentDocument | null): string | null {
  if (!document) return null;

  if (
    document.kind === "files" ||
    document.kind === "strings" ||
    document.kind === "declarations"
  ) {
    return document.layerName;
  }

  if (document.kind === "preview" || document.kind === "object") {
    return document.asset.kind === "layer" ? document.asset.layer : null;
  }

  return null;
}
