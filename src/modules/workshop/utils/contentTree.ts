import type { ContentEntry } from "@/lib/tauri";

export type ContentTreeNode = DirNode | FileNode;

export interface DirNode {
  readonly type: "dir";
  /** The directory's own name, or every segment of a folded chain joined by "/". */
  readonly name: string;
  /** Path relative to the layer root, POSIX-style, no trailing slash. */
  readonly path: string;
  readonly children: ContentTreeNode[];
}

export interface FileNode {
  readonly type: "file";
  readonly name: string;
  readonly entry: ContentEntry;
}

/**
 * Group a layer's flat file entries into a nested directory/file tree.
 *
 * Entries keep the order they were given within each directory — the backend
 * already sorts by relative path, so the tree inherits that ordering. Within a
 * single directory, children are then sorted directories-first, each group
 * alphabetically, to match typical file-tree expectations.
 *
 * A run of directories that each hold nothing but the next one folds into a
 * single row naming the whole run, the way an editor's explorer does. Those
 * rows carry no information of their own and cost one indent level each.
 */
export function buildContentTree(entries: readonly ContentEntry[]): ContentTreeNode[] {
  const root: DirNode = { type: "dir", name: "", path: "", children: [] };

  for (const entry of entries) {
    const segments = entry.relativePath.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let cursor: DirNode = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      const childPath = cursor.path ? `${cursor.path}/${segment}` : segment;

      let next = cursor.children.find((c): c is DirNode => c.type === "dir" && c.name === segment);
      if (!next) {
        next = { type: "dir", name: segment, path: childPath, children: [] };
        (cursor.children as ContentTreeNode[]).push(next);
      }
      cursor = next;
    }

    const fileName = segments[segments.length - 1]!;
    (cursor.children as ContentTreeNode[]).push({
      type: "file",
      name: fileName,
      entry,
    });
  }

  sortRecursive(root);
  return foldChains(root.children);
}

/** The one directory a node holds, when it holds nothing else at all. */
function onlyChildDir(dir: DirNode): DirNode | undefined {
  if (dir.children.length !== 1) return undefined;
  const only = dir.children[0]!;
  if (only.type !== "dir") return undefined;
  return only;
}

/* The folded row takes the deepest path of its run, so expanding it, counting its
   files and revealing it in Explorer all address the directory that holds them. */
function foldChains(nodes: readonly ContentTreeNode[]): ContentTreeNode[] {
  return nodes.map((node) => {
    if (node.type !== "dir") return node;

    let deepest = node;
    let name = node.name;

    let only = onlyChildDir(deepest);
    while (only) {
      deepest = only;
      name = `${name}/${only.name}`;
      only = onlyChildDir(deepest);
    }

    return { type: "dir", name, path: deepest.path, children: foldChains(deepest.children) };
  });
}

/**
 * Whether a row stands for `path`, directly or as part of the run it folded.
 *
 * A folded row carries only the deepest path of its run, so a request to reveal
 * any directory above that has no row of its own to land on.
 */
export function nodeCovers(node: ContentTreeNode, path: string): boolean {
  if (node.type === "file") return node.entry.relativePath === path;
  return node.path === path || node.path.startsWith(`${path}/`);
}

function sortRecursive(dir: DirNode): void {
  (dir.children as ContentTreeNode[]).sort(compareNodes);
  for (const child of dir.children) {
    if (child.type === "dir") sortRecursive(child);
  }
}

function compareNodes(a: ContentTreeNode, b: ContentTreeNode): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export interface FlatTreeRow {
  readonly node: ContentTreeNode;
  readonly depth: number;
}

/**
 * Walk a tree and produce the linear list of rows that should currently be
 * rendered, respecting expand/collapse state. A directory is always included.
 * Its children are included unless its path is in `collapsed`.
 *
 * The set names what is shut rather than what is open, so a directory the scan
 * has only just found renders expanded like the rest. A set of open paths would
 * have to be reconciled against every refetch to reach the same result, and a
 * stale entry in this one costs nothing because it names a path that is gone.
 *
 * Feeds `@tanstack/react-virtual` so we only render what's visible regardless
 * of how many files the project contains.
 */
export function flattenTree(
  tree: readonly ContentTreeNode[],
  collapsed: ReadonlySet<string>,
): FlatTreeRow[] {
  const out: FlatTreeRow[] = [];
  const walk = (nodes: readonly ContentTreeNode[], depth: number): void => {
    for (const node of nodes) {
      out.push({ node, depth });
      if (node.type === "dir" && !collapsed.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(tree, 0);
  return out;
}

/**
 * Collect the paths of every directory node in a tree.
 *
 * This is the collapsed-set that shuts every directory at once, and the inverse
 * of the empty set that opens them all.
 */
export function allDirPaths(tree: readonly ContentTreeNode[]): Set<string> {
  const set = new Set<string>();
  const walk = (nodes: readonly ContentTreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === "dir") {
        set.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(tree);
  return set;
}

/**
 * Precompute the recursive file count for every directory. Rendered rows read
 * this in O(1) instead of re-walking the subtree on every paint.
 */
export function buildDirFileCounts(tree: readonly ContentTreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (nodes: readonly ContentTreeNode[]): number => {
    let total = 0;
    for (const node of nodes) {
      if (node.type === "file") {
        total += 1;
      } else {
        const subCount = walk(node.children);
        counts.set(node.path, subCount);
        total += subCount;
      }
    }
    return total;
  };
  walk(tree);
  return counts;
}

export interface LayerWad {
  /** Matches a tree node's path, so the tree can find what to scroll to. */
  readonly path: string;
  readonly name: string;
  readonly kind: "wad" | "file";
  readonly fileCount: number;
  readonly sizeBytes: number;
}

/**
 * Summarise a layer by its top level - one row per WAD, plus any loose file.
 *
 * Sizes come back as numbers rather than the entries' `bigint`, which is what
 * `formatBytes` and a sort comparator both want.
 */
export function buildLayerWads(entries: readonly ContentEntry[]): LayerWad[] {
  const roots = new Map<
    string,
    { name: string; kind: "wad" | "file"; count: number; size: number }
  >();

  for (const entry of entries) {
    const segments = entry.relativePath.split("/").filter((s) => s.length > 0);
    const name = segments[0];
    if (!name) continue;

    const existing = roots.get(name);
    const size = Number(entry.sizeBytes);
    if (existing) {
      existing.count += 1;
      existing.size += size;
    } else {
      roots.set(name, { name, kind: segments.length > 1 ? "wad" : "file", count: 1, size });
    }
  }

  return [...roots.values()].map((root) => ({
    path: root.name,
    name: root.name,
    kind: root.kind,
    fileCount: root.count,
    sizeBytes: root.size,
  }));
}
