import type { WorkshopProject } from "@/lib/tauri";
import type { EditorDocumentBase } from "@/modules/editor";

interface DetailsDoc extends EditorDocumentBase {
  kind: "details";
}

interface FilesDoc extends EditorDocumentBase {
  kind: "files";
  layerName: string;
}

interface StringsDoc extends EditorDocumentBase {
  kind: "strings";
  layerName: string;
  locale: string;
}

/** Something the content editor can open: the project's details, a layer's files, or a locale. */
export type ContentDocument = DetailsDoc | FilesDoc | StringsDoc;

/** One kind of content document, for an editor that only handles that kind. */
export type ContentDocumentOf<K extends ContentDocument["kind"]> = Extract<
  ContentDocument,
  { kind: K }
>;

/** The project has one set of details, so its document needs nothing to key on. */
export const DETAILS_DOCUMENT_ID = "details";

export function detailsDocument(): ContentDocument {
  return { id: DETAILS_DOCUMENT_ID, kind: "details" };
}

export function filesDocument(layerName: string): ContentDocument {
  return { id: `files:${layerName}`, kind: "files", layerName };
}

export function stringsDocument(layerName: string, locale: string): ContentDocument {
  return { id: `strings:${layerName}:${locale}`, kind: "strings", layerName, locale };
}

/** The layer a document edits. Details belongs to the project rather than to one layer. */
export function documentLayerName(document: ContentDocument | null): string | null {
  if (!document || document.kind === "details") return null;
  return document.layerName;
}

/** What a layer is called on screen, falling back to the name on disk. */
export function layerTitle(project: WorkshopProject, layerName: string): string {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.displayName ?? layerName;
}
