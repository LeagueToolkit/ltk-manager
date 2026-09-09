/**
 * What an explorer lists at a location, and the map a whole-source explorer
 * reads those listings out of.
 *
 * The folded game index answers one directory at a time from Rust, so its
 * listings arrive already in this shape. An archive hands over its whole chunk
 * table at once, and [`listingsOf`] turns that into the same shape, folded and
 * sorted the way the index folds and sorts its own.
 */

import type { SourceDirListing, SourceDirSummary, SourceEntry } from "../gameBrowser/sourceIndex";
import { UNKNOWN_DIR } from "../gameBrowser/sourceIndex";
import { compareNames } from "../utils/naturalOrder";

/** One thing an explorer draws: a directory to descend into, or a file to open. */
export type ExplorerItem = ExplorerDirItem | ExplorerFileItem;

export interface ExplorerDirItem {
  readonly kind: "dir";
  /** The directory's path in its source, which is what the selection holds it by. */
  readonly id: string;
  /** A folded chain arrives as its segments joined by "/". */
  readonly name: string;
  readonly fileCount: number;
}

export interface ExplorerFileItem {
  readonly kind: "file";
  /** The chunk's path hash, which is what the selection holds it by. */
  readonly id: string;
  /** The path's basename, or the hash where no hash table names the chunk. */
  readonly name: string;
  readonly entry: SourceEntry;
}

/** The listing's rows in the order a view draws them, directories first. */
export function itemsOf(listing: SourceDirListing): ExplorerItem[] {
  const dirs = listing.dirs.map<ExplorerDirItem>((dir) => ({
    kind: "dir",
    id: dir.path,
    name: dir.name,
    fileCount: dir.fileCount,
  }));

  const files = listing.files.map(fileItemOf);

  return [...dirs, ...files];
}

/** One entry as the row a view draws, wherever the entry was read from. */
/** The path a selection covers for this item, and null for an unnamed chunk. */
export function itemPath(item: ExplorerItem): string | null {
  return item.kind === "dir" ? item.id : item.entry.path;
}

export function fileItemOf(entry: SourceEntry): ExplorerFileItem {
  return { kind: "file", id: entry.pathHash, name: basename(entry), entry };
}

interface MutableDir {
  readonly path: string;
  readonly dirs: Map<string, MutableDir>;
  readonly files: SourceEntry[];
  /** Every file below, filled once the walk reaches the bottom. */
  total: number;
}

/**
 * Every directory of a whole-source read, by its path.
 *
 * A key exists for each directory a path names, the folded chain's own
 * segments included, so a crumb inside a fold is a place the explorer lands
 * on. `""` is the root, and [`UNKNOWN_DIR`] is the group of entries no hash
 * table names.
 */
export function listingsOf(entries: readonly SourceEntry[]): ReadonlyMap<string, SourceDirListing> {
  const root: MutableDir = { path: "", dirs: new Map(), files: [], total: 0 };
  const unnamed: SourceEntry[] = [];

  for (const entry of entries) {
    if (entry.path === null) {
      unnamed.push(entry);
      continue;
    }

    const segments = entry.path.split("/").filter((part) => part.length > 0);
    if (segments.length === 0) continue;

    let cursor = root;
    for (const segment of segments.slice(0, -1)) {
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = {
          path: cursor.path.length === 0 ? segment : `${cursor.path}/${segment}`,
          dirs: new Map(),
          files: [],
          total: 0,
        };
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }
    cursor.files.push(entry);
  }

  count(root);

  const listings = new Map<string, SourceDirListing>();
  collect(root, listings);

  if (unnamed.length > 0) {
    /* Codepoint order, the way the index sorts its own unnamed group: these are
       all 16 hex digits, and reading the leading digit run of each as a number
       interleaves them by it. */
    const sorted = [...unnamed].sort((a, b) => (a.pathHash < b.pathHash ? -1 : 1));
    listings.set(UNKNOWN_DIR, { dirs: [], files: sorted });

    const rootListing = listings.get("")!;
    /* After every named row, so the junk drawer never pushes real paths down. */
    listings.set("", {
      dirs: [
        ...rootListing.dirs,
        { path: UNKNOWN_DIR, name: "unknown", fileCount: unnamed.length },
      ],
      files: rootListing.files,
    });
  }

  return listings;
}

/** Every file below `path`, walked through the listings the source gave. */
export function filesUnderPath(
  listings: ReadonlyMap<string, SourceDirListing>,
  path: string,
): SourceEntry[] {
  const out: SourceEntry[] = [];

  const walk = (at: string): void => {
    const listing = listings.get(at);
    if (!listing) return;
    out.push(...listing.files);
    for (const dir of listing.dirs) walk(dir.path);
  };

  walk(path);
  return out;
}

/** Fill each directory's recursive file count, bottom up. */
function count(dir: MutableDir): number {
  let total = dir.files.length;
  for (const child of dir.dirs.values()) total += count(child);
  dir.total = total;
  return total;
}

function collect(dir: MutableDir, into: Map<string, SourceDirListing>): void {
  const dirs: SourceDirSummary[] = [];

  for (const child of dir.dirs.values()) {
    dirs.push(fold(child));
    collect(child, into);
  }

  dirs.sort((a, b) => compareNames(a.name, b.name));
  into.set(dir.path, {
    dirs,
    files: [...dir.files].sort((a, b) => compareNames(basename(a), basename(b))),
  });
}

/**
 * One child row, walked down its chain of single-child directories.
 *
 * A run of directories that each hold nothing but the next one is one row, so a
 * modder scanning a tree of asset paths spends no rows on chains that carry no
 * choice. The row keeps the deepest path of the run, which is the directory
 * that actually holds the files.
 */
function fold(dir: MutableDir): SourceDirSummary {
  let cursor = dir;
  let name = lastSegment(dir.path);

  while (cursor.files.length === 0 && cursor.dirs.size === 1) {
    const only = cursor.dirs.values().next().value!;
    name = `${name}/${lastSegment(only.path)}`;
    cursor = only;
  }

  return { path: cursor.path, name, fileCount: dir.total };
}

function lastSegment(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

function basename(entry: SourceEntry): string {
  if (entry.path === null) return entry.pathHash;
  return lastSegment(entry.path);
}
