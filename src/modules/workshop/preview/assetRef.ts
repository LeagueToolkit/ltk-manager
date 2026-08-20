import { convertFileSrc } from "@tauri-apps/api/core";

import type { AssetRef } from "@/lib/tauri";

/** The URI scheme the backend serves a rendered preview on. */
const SCHEME = "ltk-asset";

/**
 * The URL an `<img>` draws this asset from.
 *
 * The backend renders whatever the file is into something the webview decodes,
 * so a `.tex` and a `.png` both arrive as an image and neither one crosses the
 * JavaScript heap.
 */
export function previewUrl(asset: AssetRef): string {
  return convertFileSrc(encodeToken(asset), SCHEME);
}

/**
 * Pack a reference into one URL path segment.
 *
 * Unpadded base64url is `A-Za-z0-9-_` alone, which is exactly the set
 * `encodeURIComponent` leaves untouched, so the token reaches the handler
 * character for character and no escaping question comes up on the way.
 */
function encodeToken(asset: AssetRef): string {
  const utf8 = new TextEncoder().encode(JSON.stringify(asset));
  const binary = Array.from(utf8, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What identifies an asset within one project, for a document id or a query key. */
export function assetKey(asset: AssetRef): string {
  if (asset.kind === "layer") return `layer:${asset.layer}:${asset.path}`;
  if (asset.kind === "gameChunk") return `game:${asset.wad}:${asset.pathHash}`;
  return `file:${asset.path}`;
}

/**
 * The file name to show for an asset.
 *
 * A game chunk reference carries a hash and no path, so it names its hash
 * unless the caller resolved one. The tree row that opens a preview did
 * resolve one, through the hash tables the reference cannot reach.
 */
export function assetName(asset: AssetRef, resolvedPath?: string): string {
  if (resolvedPath !== undefined) return basename(resolvedPath);
  if (asset.kind === "gameChunk") return asset.pathHash;
  return basename(asset.path);
}

/**
 * What addresses the asset outside the app, for a Copy path.
 *
 * A layer file and a loose file have a path on disk. A chunk has none, so it
 * reads as its archive and then the path inside it, falling back to the hash
 * for a chunk no hash table names.
 */
export function assetPath(asset: AssetRef, resolvedPath?: string): string {
  if (asset.kind === "layer") {
    return `${asset.project}/content/${asset.layer}/${asset.path}`;
  }
  if (asset.kind === "gameChunk") return `${asset.wad}/${resolvedPath ?? asset.pathHash}`;
  return asset.path;
}

/** Where the asset came from, for the tab's dim context field. */
export function assetContext(asset: AssetRef): string | undefined {
  if (asset.kind === "layer") return asset.layer;
  /* Without `.wad.client`, which every archive carries and no reader needs in
     order to tell two of them apart. */
  if (asset.kind === "gameChunk") return basename(asset.wad).replace(/\.wad\.client$/i, "");
  return undefined;
}

function basename(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? path : path.slice(cut + 1);
}
