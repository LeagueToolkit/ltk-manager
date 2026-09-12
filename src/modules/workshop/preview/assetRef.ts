import type { AssetRef } from "@/lib/tauri";

export { previewUrl } from "@/lib/previewUrl";

/** The archive a chunk's bytes come from, and null for a file that mounts none. */
export function assetArchive(asset: AssetRef): string | null {
  return asset.kind === "gameChunk" ? asset.wad : null;
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
