import type { AssetRef, ProjectTextFile, WorkshopProject } from "@/lib/tauri";
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

interface ProblemsDoc extends EditorDocumentBase {
  kind: "problems";
}

interface IgnoreRulesDoc extends EditorDocumentBase {
  kind: "ignore-rules";
  /** The file's project-relative path, absent for the project's root rules. */
  at?: string;
}

interface TextFileDoc extends EditorDocumentBase {
  kind: "text";
  /** Which of the project's root text files this is. */
  file: ProjectTextFile;
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

interface ObjectsDoc extends EditorDocumentBase {
  kind: "objects";
}

interface ReferencesDoc extends EditorDocumentBase {
  kind: "references";
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

/** One declaration of a bin object, keyed on the asset and the object hash (ADR-0028). */
interface ObjectDoc extends EditorDocumentBase {
  kind: "object";
  asset: AssetRef;
  /** `0x` and eight hex digits. */
  objectHash: string;
  /** The object's path, or its hash when nothing names it. */
  objectPath: string;
  /** The declaring file's path, or the chunk hash when nothing names it. */
  file: string;
  /** The class the object declares, for its mark. Absent on a tab written before the field. */
  objectClass?: string | null;
}

/**
 * Something the content editor can open: the project's details, a layer's
 * files, a locale, or a browser over the installed game's archives or objects.
 */
export type ContentDocument =
  | DetailsDoc
  | FilesDoc
  | StringsDoc
  | ProblemsDoc
  | IgnoreRulesDoc
  | TextFileDoc
  | GameDoc
  | GameWadsDoc
  | GameWadDoc
  | ObjectsDoc
  | ReferencesDoc
  | PreviewDoc
  | ObjectDoc;

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

/** The project's root `.modignore`, the one file every project has. */
export const IGNORE_RULES_DOCUMENT_ID = "ignore-rules";

/** The rules at project-relative `at`, or the project's root file for none. */
export function ignoreRulesDocument(at?: string): ContentDocumentOf<"ignore-rules"> {
  if (at === undefined) return { id: IGNORE_RULES_DOCUMENT_ID, kind: "ignore-rules" };
  return { id: `${IGNORE_RULES_DOCUMENT_ID}:${at}`, kind: "ignore-rules", at };
}

/** The project's readme, the one root text file a route opens today. */
export const README_DOCUMENT_ID = "text:readme";

/**
 * One of the project's root text files.
 *
 * A project holds one of each, so the file is what keys the document and a
 * second one costs a caller rather than a kind.
 */
export function projectTextDocument(file: ProjectTextFile): ContentDocumentOf<"text"> {
  return { id: `text:${file}`, kind: "text", file };
}

/** A run covers the whole project, so its document needs nothing to key on. */
export const PROBLEMS_DOCUMENT_ID = "problems";

export function problemsDocument(): ContentDocument {
  return { id: PROBLEMS_DOCUMENT_ID, kind: "problems" };
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

/** The install has one tree of objects. Its browser needs nothing to key on. */
export const OBJECTS_DOCUMENT_ID = "objects";

export function objectsDocument(): ContentDocument {
  return { id: OBJECTS_DOCUMENT_ID, kind: "objects" };
}

/** One project answers one query at a time, so its document needs nothing to key on. */
export const REFERENCES_DOCUMENT_ID = "references";

export function referencesDocument(): ContentDocument {
  return { id: REFERENCES_DOCUMENT_ID, kind: "references" };
}

/**
 * The tab one asset takes, whether or not that tab is open.
 *
 * Keyed by what the reference names and not by the resolved path, so a second
 * request for one asset activates the tab that is already open rather than
 * adding another. Split out from {@link previewDocument} for a caller that
 * wants to name the tab without building it - the palette names thousands.
 */
export function previewDocumentId(asset: AssetRef): string {
  return `preview:${assetKey(asset)}`;
}

/**
 * One asset, opened in its own tab.
 *
 * `resolvedPath` is what a hash table made of a game chunk's hash, which the
 * reference itself cannot carry. Layer and loose-file references already hold
 * their path, so those callers pass nothing.
 */
export function previewDocument(
  asset: AssetRef,
  resolvedPath?: string,
): ContentDocumentOf<"preview"> {
  return {
    id: previewDocumentId(asset),
    kind: "preview",
    asset,
    title: assetName(asset, resolvedPath),
    context: assetContext(asset),
    path: assetPath(asset, resolvedPath),
  };
}

/** The tab one declaration takes, whether or not that tab is open. */
export function objectDocumentId(asset: AssetRef, objectHash: string): string {
  return `object:${assetKey(asset)}:${objectHash}`;
}

/**
 * One declaration of an object, opened in its own tab.
 *
 * `objectPath` is the object's path as whatever opened the tab knew it, and `file`
 * the declaring file's path the same way. A chunk no hash table names carries its hash
 * in both.
 */
export function objectDocument(
  asset: AssetRef,
  objectHash: string,
  objectPath: string,
  file: string,
  objectClass: string | null = null,
): ContentDocument {
  return {
    id: objectDocumentId(asset, objectHash),
    kind: "object",
    asset,
    objectHash,
    objectPath,
    file,
    objectClass,
  };
}

/** The last `/` segment of an object path, which is the object tab's title. */
export function objectTitle(objectPath: string): string {
  const cut = objectPath.lastIndexOf("/");
  return cut < 0 ? objectPath : objectPath.slice(cut + 1);
}

/**
 * The declaring file for an object tab's context field: where the asset sits, an
 * elision, and the file's name.
 */
export function declaringFileContext(asset: AssetRef, file: string): string {
  const where = assetContext(asset);
  const cut = Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\"));
  const name = cut < 0 ? file : file.slice(cut + 1);
  if (where === undefined) return name;
  return cut < 0 ? `${where}/${name}` : `${where}/…/${name}`;
}

/** The layer a document edits, or null for the ones that belong to no layer. */
export function documentLayerName(document: ContentDocument | null): string | null {
  if (!document) return null;
  if (document.kind === "files" || document.kind === "strings") return document.layerName;
  if (document.kind === "preview" || document.kind === "object") {
    return document.asset.kind === "layer" ? document.asset.layer : null;
  }
  return null;
}

/** What a layer is called on screen, falling back to the name on disk. */
export function layerTitle(project: WorkshopProject, layerName: string): string {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.displayName ?? layerName;
}
