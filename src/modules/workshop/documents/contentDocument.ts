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

interface GameDoc extends EditorDocumentBase {
  kind: "game";
}

interface GameWadsDoc extends EditorDocumentBase {
  kind: "game-wads";
}

interface GameWadDoc extends EditorDocumentBase {
  kind: "game-wad";
  wadName: string;
}

/**
 * Something the content editor can open: the project's details, a layer's
 * files, a locale, or a browser over the installed game's archives.
 */
export type ContentDocument =
  | DetailsDoc
  | FilesDoc
  | StringsDoc
  | GameDoc
  | GameWadsDoc
  | GameWadDoc;

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

/** The game has one root browser over one install, so its document needs nothing to key on. */
export const GAME_DOCUMENT_ID = "game";

export function gameDocument(): ContentDocument {
  return { id: GAME_DOCUMENT_ID, kind: "game" };
}

/** The install has one set of archives, so its list needs nothing to key on. */
export const GAME_WADS_DOCUMENT_ID = "game-wads";

export function gameWadsDocument(): ContentDocument {
  return { id: GAME_WADS_DOCUMENT_ID, kind: "game-wads" };
}

/* Keyed by archive name, so a second request for the same archive activates
   the tab that is already open. */
export function gameWadDocument(wadName: string): ContentDocument {
  return { id: `game-wad:${wadName}`, kind: "game-wad", wadName };
}

/** The layer a document edits, or null for the ones that belong to no layer. */
export function documentLayerName(document: ContentDocument | null): string | null {
  if (!document) return null;
  if (document.kind === "files" || document.kind === "strings") return document.layerName;
  return null;
}

/** What a layer is called on screen, falling back to the name on disk. */
export function layerTitle(project: WorkshopProject, layerName: string): string {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.displayName ?? layerName;
}
