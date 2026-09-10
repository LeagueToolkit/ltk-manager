/**
 * The order an explorer draws its rows in, under every view.
 *
 * A sort applies to the whole explorer rather than to the open directory
 * alone, so a tree sorted by size is sorted by size at every depth. Nothing
 * here reaches a source: an archive holds every entry already, and the index
 * answers one directory at a time, so a sort reads rows the frontend holds
 * either way.
 */

import { fileKindFromPath } from "../gameBrowser/fileKind";
import type { SourceDirNode, SourceFileNode, SourceTreeNode } from "../gameBrowser/sourceIndex";
import { compareNames } from "../utils/naturalOrder";
import type { ExplorerDirItem, ExplorerFileItem, ExplorerItem } from "./items";

export type ExplorerSortField = "name" | "size" | "kind";
export type ExplorerSortDirection = "asc" | "desc";

export interface ExplorerSort {
  readonly field: ExplorerSortField;
  readonly direction: ExplorerSortDirection;
}

export const DEFAULT_SORT: ExplorerSort = { field: "name", direction: "asc" };

/** One row as the comparators read it: a label, a size, and nothing else. */
interface Sortable {
  readonly name: string;
  readonly sizeBytes: number;
}

/** The rows in sorted order, directories ahead of the files. */
export function sortItems(
  items: readonly ExplorerItem[],
  sort: ExplorerSort,
): readonly ExplorerItem[] {
  const dirs = items.filter((item): item is ExplorerDirItem => item.kind === "dir");
  const files = items.filter((item): item is ExplorerFileItem => item.kind === "file");

  return [...sortDirs(dirs, sort), ...sortFiles(files, sort, (file) => file.entry.sizeBytes)];
}

/**
 * The same order, applied down a tree.
 *
 * A directory still reading its listing draws one standing row, which sorts to
 * the end so it never displaces a row that is already there.
 */
export function sortTree(
  nodes: readonly SourceTreeNode[],
  sort: ExplorerSort,
): readonly SourceTreeNode[] {
  const dirs = nodes.filter((node): node is SourceDirNode => node.type === "dir");
  const files = nodes.filter((node): node is SourceFileNode => node.type === "file");
  const loading = nodes.filter((node) => node.type === "loading");

  const sortedDirs = sortDirs(dirs, sort).map((node) => ({
    ...node,
    children: sortTree(node.children, sort),
  }));

  return [...sortedDirs, ...sortFiles(files, sort, (file) => file.entry.sizeBytes), ...loading];
}

/**
 * Directories never sort by size or by kind: a directory is neither, and no
 * source totals the bytes below one, so the name is what is left to read.
 */
function sortDirs<T extends { readonly name: string }>(
  dirs: readonly T[],
  sort: ExplorerSort,
): T[] {
  const flip = sort.direction === "desc" ? -1 : 1;
  return [...dirs].sort((a, b) => flip * compareNames(a.name, b.name));
}

function sortFiles<T extends { readonly name: string }>(
  files: readonly T[],
  sort: ExplorerSort,
  sizeOf: (file: T) => number,
): T[] {
  const flip = sort.direction === "desc" ? -1 : 1;

  return [...files].sort((a, b) => {
    const left = { name: a.name, sizeBytes: sizeOf(a) };
    const right = { name: b.name, sizeBytes: sizeOf(b) };
    const primary = comparePrimary(left, right, sort.field);
    /* The name breaks a tie in its own ascending order rather than the sort's,
       so a run of equal sizes reads the same whichever way the sort points. */
    return primary !== 0 ? flip * primary : compareNames(a.name, b.name);
  });
}

function comparePrimary(a: Sortable, b: Sortable, field: ExplorerSortField): number {
  if (field === "size") return a.sizeBytes - b.sizeBytes;

  if (field === "kind") {
    const left = fileKindFromPath(a.name);
    const right = fileKindFromPath(b.name);
    /* Codepoint order over the kind identifiers, which are ASCII. A collator
       would resolve to the host locale and let two machines disagree. */
    return left < right ? -1 : left > right ? 1 : 0;
  }

  return compareNames(a.name, b.name);
}
