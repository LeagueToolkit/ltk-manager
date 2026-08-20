import type { AssetRef, WorkshopProject } from "@/lib/tauri";
import type { EditorDocumentBase } from "@/modules/editor";

/* The reference helpers rather than the preview barrel, which pulls the viewer
   whose props type circles back into this file. */
import { assetContext, assetKey, assetName, assetPath } from "../preview/assetRef";

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

interface PreviewDoc extends EditorDocumentBase {
  kind: "preview";
  asset: AssetRef;
  /** The file name, or the chunk hash when nothing names it. */
  title: string;
  /** Where the asset came from, for the tab's dim context field. */
  context?: string;
  /** What addresses the asset outside the app, for the tab's Copy path. */
  path?: string;
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
  | GameWadDoc
  | PreviewDoc;

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

/**
 * One asset, opened in its own tab.
 *
 * `resolvedPath` is what a hash table made of a game chunk's hash, which the
 * reference itself cannot carry. Layer and loose-file references already hold
 * their path, so those callers pass nothing.
 *
 * Keyed by what the reference names and not by the resolved path, so a second
 * request for one asset activates the tab that is already open rather than
 * adding another.
 */
export function previewDocument(asset: AssetRef, resolvedPath?: string): ContentDocument {
  return {
    id: `preview:${assetKey(asset)}`,
    kind: "preview",
    asset,
    title: assetName(asset, resolvedPath),
    context: assetContext(asset),
    path: assetPath(asset, resolvedPath),
  };
}

/** The layer a document edits, or null for the ones that belong to no layer. */
export function documentLayerName(document: ContentDocument | null): string | null {
  if (!document) return null;
  if (document.kind === "files" || document.kind === "strings") return document.layerName;
  if (document.kind === "preview" && document.asset.kind === "layer") return document.asset.layer;
  return null;
}

/** What a layer is called on screen, falling back to the name on disk. */
export function layerTitle(project: WorkshopProject, layerName: string): string {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.displayName ?? layerName;
}
