import type { AssetRef } from "@/lib/tauri";
import type { EditorDocumentBase } from "@/modules/editor";

/* The reference helpers rather than the preview barrel, which pulls the viewer
   whose props type circles back into this module. */
import { assetContext, assetKey, assetName, assetPath } from "../../../preview/utils/assetRef";

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
export function previewDocument(asset: AssetRef, resolvedPath?: string): PreviewDoc {
  return {
    id: previewDocumentId(asset),
    kind: "preview",
    asset,
    title: assetName(asset, resolvedPath),
    context: assetContext(asset),
    path: assetPath(asset, resolvedPath),
  };
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
): ObjectDoc {
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

/** One asset or one object, opened in its own tab. */
export type AssetDoc = PreviewDoc | ObjectDoc;
