/**
 * Turning the browser's rows into the targets an extract takes.
 *
 * Which shape a directory row becomes depends on the tree it sits in, and that
 * is the only interesting decision here. A tree that already holds every row
 * expands its own directories. The whole-game tree reads a directory when it is
 * first opened, so a shut row there holds no children and the backend expands
 * it through the index instead.
 */

import type { AssetRef, ExtractTarget } from "@/lib/tauri";

import type { SourceDirNode, SourceEntry, SourceFileNode, SourceTreeNode } from "./sourceIndex";

/** How a tree turns one of its directory rows into targets. */
export type DirTargets = (node: SourceDirNode) => ExtractTarget[];

/** One entry, as the thing to extract. */
export function entryTarget(entry: SourceEntry): ExtractTarget {
  return {
    kind: "file",
    wad: entry.wad,
    pathHash: entry.pathHash,
    path: entry.path,
    sizeBytes: entry.sizeBytes,
  };
}

/** One file row, as the thing to extract. */
export function fileTarget(node: SourceFileNode): ExtractTarget {
  return entryTarget(node.entry);
}

/** Every file below a directory row, walked on this side. */
export const filesUnder: DirTargets = (node) => {
  const out: ExtractTarget[] = [];
  const walk = (nodes: readonly SourceTreeNode[]): void => {
    for (const child of nodes) {
      if (child.type === "file") out.push(fileTarget(child));
      if (child.type === "dir") walk(child.children);
    }
  };
  walk(node.children);
  return out;
};

/** A directory of the folded game index, which the backend expands. */
export const indexDir: DirTargets = (node) => [indexDirTarget(node.path)];

/** The same, for a directory named by its path rather than by a row. */
export function indexDirTarget(path: string): ExtractTarget {
  return { kind: "dir", path };
}

/** Every chunk of one archive, read out of the archive rather than the index. */
export function archiveTarget(wad: string): ExtractTarget {
  return { kind: "archive", wad };
}

/**
 * One previewed asset, as the thing to extract. `null` for a project file.
 *
 * `displayPath` is the tab's own path field, which prefixes the chunk path
 * with its archive, so the chunk path is what is left once that comes off. A
 * chunk no hash table names has its hash there instead, and a hash is not a
 * path - the extractor names such a chunk itself.
 */
export function chunkTarget(asset: AssetRef, displayPath?: string): ExtractTarget | null {
  if (asset.kind !== "gameChunk") return null;

  const prefix = `${asset.wad}/`;
  const inside = displayPath?.startsWith(prefix) ? displayPath.slice(prefix.length) : undefined;

  return {
    kind: "file",
    wad: asset.wad,
    pathHash: asset.pathHash,
    path: inside && inside !== asset.pathHash ? inside : null,
    /* Only the dialog's plan reads this, and a preview tab was opened with a
       reference rather than with the row that knew the size. */
    sizeBytes: 0,
  };
}
