/**
 * A read-only tree over some source of game content - the installed game's
 * archives today, an index over a mod package later. Everything here is pure
 * and speaks the plain `SourceEntry` shape, so any backend feeds it through a
 * thin adapter and nothing in this file imports one.
 */

/** The path the index gives the group of entries no hash table names. */
export const UNKNOWN_DIR = "?";

export interface SourceEntry {
  /** 16 lowercase hex digits naming the chunk. */
  readonly pathHash: string;
  /** Resolved path with forward slashes, or null when no hash table names it. */
  readonly path: string | null;
  readonly sizeBytes: number;
  /**
   * The `DATA/FINAL`-relative archive holding the chunk.
   *
   * What a read of the bytes needs, since the folded index merges its archives
   * away and a row carries no other route back to one.
   */
  readonly wad: string;
}

/** One subdirectory of a lazily-read index, as its parent listing names it. */
export interface SourceDirSummary {
  /** What addresses the directory in its index, and the row's expansion key. */
  readonly path: string;
  /** The row's label: a folded chain arrives as its segments joined by "/". */
  readonly name: string;
  readonly fileCount: number;
}

/** What one directory of a lazily-read index holds. */
export interface SourceDirListing {
  readonly dirs: readonly SourceDirSummary[];
  readonly files: readonly SourceEntry[];
}

export type SourceTreeNode = SourceDirNode | SourceFileNode | SourceLoadingNode;

export interface SourceDirNode {
  readonly type: "dir";
  readonly id: string;
  /** The directory's own name, or every segment of a folded chain joined by "/". */
  readonly name: string;
  /** True for the group holding the entries with no resolved path. */
  readonly unknown: boolean;
  readonly fileCount: number;
  readonly children: readonly SourceTreeNode[];
}

export interface SourceFileNode {
  readonly type: "file";
  readonly id: string;
  /** The path's basename, or the hash in hex when the path is unknown. */
  readonly name: string;
  readonly entry: SourceEntry;
}

/** Stands in for an expanded directory whose listing is still in flight. */
export interface SourceLoadingNode {
  readonly type: "loading";
  readonly id: string;
}

interface MutableDir {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: SourceFileNode[];
}

/**
 * Group entries into a directory/file tree, the way the layer file tree does.
 *
 * Entries with a resolved path nest under their path segments, directories
 * first and each group alphabetical, and a run of directories that each hold
 * nothing but the next one folds into a single row. Entries with no path
 * gather under one `unknown` group. Directory rows carry their recursive file
 * count, so rendered rows read it in O(1).
 *
 * `idPrefix` namespaces every node id, which is what keeps two archives with
 * the same inner paths apart in one forest.
 */
export function buildSourceTree(entries: readonly SourceEntry[], idPrefix = ""): SourceTreeNode[] {
  const root: MutableDir = { name: "", path: "", dirs: new Map(), files: [] };
  const unknown: SourceFileNode[] = [];

  for (const entry of entries) {
    if (entry.path === null) {
      unknown.push(fileNode(entry, entry.pathHash, idPrefix));
      continue;
    }

    const segments = entry.path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i]!;
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: cursor.path ? `${cursor.path}/${segment}` : segment,
          dirs: new Map(),
          files: [],
        };
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push(fileNode(entry, segments[segments.length - 1]!, idPrefix));
  }

  const { children } = finalizeChildren(root, idPrefix);

  if (unknown.length > 0) {
    unknown.sort((a, b) => a.name.localeCompare(b.name));
    /* After every named entry, so the junk drawer never pushes real paths down. */
    children.push({
      type: "dir",
      id: `${idPrefix}u:unknown`,
      name: "unknown",
      unknown: true,
      fileCount: unknown.length,
      children: unknown,
    });
  }

  return children;
}

function fileNode(entry: SourceEntry, name: string, idPrefix: string): SourceFileNode {
  return { type: "file", id: `${idPrefix}f:${entry.pathHash}`, name, entry };
}

function finalizeChildren(
  dir: MutableDir,
  idPrefix: string,
): { children: SourceTreeNode[]; fileCount: number } {
  const dirs: SourceDirNode[] = [];
  let fileCount = 0;

  for (let sub of dir.dirs.values()) {
    /* The folded row keeps the deepest path of its run, so expansion state
       addresses the directory that actually holds the files. */
    let name = sub.name;
    while (sub.files.length === 0 && sub.dirs.size === 1) {
      const only = sub.dirs.values().next().value!;
      name = `${name}/${only.name}`;
      sub = only;
    }

    const inner = finalizeChildren(sub, idPrefix);
    dirs.push({
      type: "dir",
      id: `${idPrefix}d:${sub.path}`,
      name,
      unknown: false,
      fileCount: inner.fileCount,
      children: inner.children,
    });
    fileCount += inner.fileCount;
  }

  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name));
  fileCount += files.length;

  return { children: [...dirs, ...files], fileCount };
}

/**
 * Materialize the part of a lazily-read index that is currently on screen.
 *
 * An index too large to hold at once arrives one directory at a time, so a
 * collapsed directory carries no children and an expanded one whose listing is
 * still in flight carries a loading row. The listing already arrives sorted
 * and folded, which is work the index does once rather than every render.
 *
 * `listings` maps a directory path to what it holds, or to null while its
 * fetch is in flight. The root is the entry under `""`.
 */
export function buildIndexTree(
  listings: ReadonlyMap<string, SourceDirListing | null>,
  isExpanded: (path: string) => boolean,
): SourceTreeNode[] {
  const build = (path: string): SourceTreeNode[] => {
    const listing = listings.get(path);
    if (!listing) return [{ type: "loading", id: `l:${path}` }];

    const dirs = listing.dirs.map<SourceDirNode>((dir) => ({
      type: "dir",
      id: dir.path,
      name: dir.name,
      unknown: dir.path === UNKNOWN_DIR,
      fileCount: dir.fileCount,
      children: isExpanded(dir.path) ? build(dir.path) : [],
    }));

    const files = listing.files.map<SourceFileNode>((entry) =>
      fileNode(entry, basename(entry), ""),
    );

    return [...dirs, ...files];
  };

  return build("");
}

function basename(entry: SourceEntry): string {
  if (entry.path === null) return entry.pathHash;
  const slash = entry.path.lastIndexOf("/");
  return slash < 0 ? entry.path : entry.path.slice(slash + 1);
}

export interface SourceRow {
  readonly node: SourceTreeNode;
  readonly depth: number;
}

/**
 * Walk a tree into the linear list of rows to render, for the virtualizer.
 *
 * Takes a predicate rather than a collapsed set, because a whole-game tree
 * starts shut and a single archive's tree starts open.
 */
export function flattenSourceTree(
  nodes: readonly SourceTreeNode[],
  isExpanded: (node: SourceDirNode) => boolean,
): SourceRow[] {
  const out: SourceRow[] = [];
  const walk = (list: readonly SourceTreeNode[], depth: number): void => {
    for (const node of list) {
      out.push({ node, depth });
      if (node.type === "dir" && isExpanded(node)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

/** Whether a root listing holds the unnamed group and nothing else. */
export function holdsOnlyUnknown(listing: SourceDirListing): boolean {
  return (
    listing.files.length === 0 &&
    listing.dirs.length > 0 &&
    listing.dirs.every((dir) => dir.path === UNKNOWN_DIR)
  );
}

/** Whether every entry lacks a path, which is what an unsynced hash table leaves. */
export function hasOnlyUnknownPaths(entries: readonly SourceEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => entry.path === null);
}

/** The archive's file name without the directories the install nests it under. */
export function wadBasename(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash < 0 ? name : name.slice(slash + 1);
}

/** The directories the install nests the archive under, empty at `DATA/FINAL` itself. */
export function wadDirname(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash < 0 ? "" : name.slice(0, slash);
}

/** The set with `value` flipped, for a tree's expansion state updates. */
export function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
