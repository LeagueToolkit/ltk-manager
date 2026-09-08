import type { AppError, BinRow, BinRows, BinValue } from "@/lib/tauri";

import { nameHash } from "./binHash";

/** How many rows one children call answers. A longer container asks again. */
export const PAGE_SIZE = 500;

/** The key a row is expanded, fetched and drawn under: its entry and its wire path. */
export function rowKey(row: Pick<BinRow, "entry" | "path">): string {
  return `${row.entry}:${row.path}`;
}

/** The key of the object row an entry hash names. */
export function objectKey(entry: string): string {
  return `${entry}:`;
}

/** A key's two halves: the entry hash and the wire path. */
export function splitKey(key: string): [entry: string, path: string] {
  const cut = key.indexOf(":");
  return [key.slice(0, cut), key.slice(cut + 1)];
}

/**
 * Whether `key` is `parent` or sits under it.
 *
 * A field is eight hex digits. A segment after it opens with `.`, `[` or `{`. `[3]` is
 * not under `[30]`. Everything of an object sits under the object's own key.
 */
export function isUnder(parent: string, key: string): boolean {
  if (key === parent) return true;
  if (parent.endsWith(":")) return key.startsWith(parent);
  return (
    key.startsWith(`${parent}.`) || key.startsWith(`${parent}[`) || key.startsWith(`${parent}{`)
  );
}

/** The hash of the field a property row's path ends in, `0x` and eight hex digits. */
export function fieldHash(path: string): string {
  return `0x${path.slice(-8)}`;
}

/**
 * The hash a map entry's key holds, or null for a key that is no hash.
 *
 * An entry whose key no table names is drawn as its own hex. A named one is drawn as
 * the name, in the JSON literal the backend writes, which hashes back to the same
 * value the key held.
 */
export function entryKeyHash(row: Pick<BinRow, "name" | "unnamed">): string | null {
  if (row.unnamed) return /^0x[0-9a-f]{8}$/i.test(row.name) ? row.name.toLowerCase() : null;
  if (!row.name.startsWith('"')) return null;
  try {
    return nameHash(JSON.parse(row.name) as string);
  } catch {
    return null;
  }
}

/** Whether rows can sit under this one. */
export function canExpand(row: BinRow): boolean {
  return holdsChildren(row.value);
}

/** How many rows sit under `row`, which is what reading it costs. */
export function childCount(row: BinRow): number {
  const { value } = row;
  switch (value.type) {
    case "struct":
    case "container":
    case "map":
      return value.len;
    case "optional":
      return value.present ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Every key on the way down to `key`, the object's own first and `key` itself last.
 *
 * A reveal opens each of them, so a row nested under a container is on screen once
 * every level has answered. A path this cannot read answers what it reached.
 */
export function ancestorKeys(key: string): string[] {
  const [entry, path] = splitKey(key);
  const keys = [`${entry}:`];
  let at = 0;
  while (at < path.length) {
    const end = segmentEnd(path, at);
    if (end === null) break;
    at = end;
    keys.push(`${entry}:${path.slice(0, at)}`);
  }
  if (keys.at(-1) !== key) keys.push(key);
  return keys;
}

/** Where the segment starting at `at` ends, or null for a path this cannot read. */
function segmentEnd(path: string, at: number): number | null {
  if (path[at] === "[") {
    const close = path.indexOf("]", at);
    return close < 0 ? null : close + 1;
  }
  if (path[at] === "{") return keyEnd(path, at + 1);

  /* A field is eight hex digits, and every one but the first opens with a dot. */
  const start = path[at] === "." ? at + 1 : at;
  return start + 8 <= path.length ? start + 8 : null;
}

/** Where the map key starting at `at` ends, quoted or bare, as the backend writes one. */
function keyEnd(path: string, at: number): number | null {
  if (path[at] !== '"') {
    const close = path.indexOf("}", at);
    return close < 0 ? null : close + 1;
  }
  let escaped = false;
  for (let scan = at + 1; scan < path.length; scan += 1) {
    if (path[scan] === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (path[scan] === '"' && !escaped) {
      return path[scan + 1] === "}" ? scan + 2 : null;
    }
    escaped = false;
  }
  return null;
}

/** The class the rows under `row` are properties of. Null under a container, a map and a leaf. */
function ownerOf(row: BinRow): string | null {
  return row.value.type === "struct" ? row.value.classHash : null;
}

function holdsChildren(value: BinValue): boolean {
  switch (value.type) {
    case "struct":
    case "container":
    case "map":
      return value.len > 0;
    case "optional":
      return value.present;
    default:
      return false;
  }
}

/** What the list holds for one expanded node: the pages that answered, in order. */
export interface LoadedChildren {
  readonly rows: readonly BinRow[];
  readonly total: number;
  /** A page is on its way. */
  readonly pending: boolean;
  /** A page failed. The rows end where it began. */
  readonly error?: AppError;
}

/** One line of the list: a row, or the request for a node's next page. */
export type VisibleRow =
  | {
      readonly kind: "row";
      readonly key: string;
      readonly row: BinRow;
      readonly depth: number;
      readonly expanded: boolean;
      /** Expanded, and the first page has not answered. */
      readonly loading: boolean;
      /** The class hash of the struct the row is a property of. Null for an object, an element and an entry. */
      readonly owner: string | null;
    }
  | {
      readonly kind: "more";
      readonly key: string;
      readonly parent: string;
      readonly depth: number;
      readonly loaded: number;
      readonly total: number;
      readonly pending: boolean;
    };

/** The line a row draws as. */
export type RowLine = Extract<VisibleRow, { kind: "row" }>;

/**
 * The lines the list draws, in order, out of the root rows and what is fetched under
 * the expanded ones.
 *
 * The frontend keeps the expansion state and the backend answers one node's children at
 * a time (ADR-0026). A node expanded before its children answer draws as loading. A node
 * with more rows than answered draws a request for the rest under what it has.
 * `rootOwner` is the class the roots are properties of, which an object tab's roots are.
 */
export function flattenRows(
  roots: readonly BinRow[],
  expanded: ReadonlySet<string>,
  childrenOf: (key: string) => LoadedChildren | undefined,
  rootOwner: string | null = null,
): VisibleRow[] {
  const out: VisibleRow[] = [];

  function visit(rows: readonly BinRow[], depth: number, owner: string | null) {
    for (const row of rows) {
      const key = rowKey(row);
      const isExpanded = expanded.has(key) && canExpand(row);
      const children = isExpanded ? childrenOf(key) : undefined;
      out.push({
        kind: "row",
        key,
        row,
        depth,
        expanded: isExpanded,
        loading: isExpanded && children === undefined,
        owner: row.node === "property" ? owner : null,
      });
      if (!children) continue;

      visit(children.rows, depth + 1, ownerOf(row));
      if (children.rows.length < children.total) {
        out.push({
          kind: "more",
          key: `${key}:more`,
          parent: key,
          depth: depth + 1,
          loaded: children.rows.length,
          total: children.total,
          pending: children.pending,
        });
      }
    }
  }

  visit(roots, 0, rootOwner);
  return out;
}

/** One page of a node's children as the query answered it, or has not. */
export interface PageResult {
  readonly data?: BinRows;
  readonly error?: AppError | null;
}

/**
 * A node's pages folded into one window of rows.
 *
 * The rows end at the first page that has not answered, and the node reads as pending.
 * A failed page ends them too and carries its error. Undefined until the first page
 * answers, which is what draws a node as loading.
 */
export function mergePages(pages: readonly PageResult[]): LoadedChildren | undefined {
  const rows: BinRow[] = [];
  let total: number | null = null;
  let pending = false;
  let error: AppError | undefined;

  for (const page of pages) {
    if (page.error) {
      error = page.error;
      break;
    }
    if (!page.data) {
      pending = true;
      break;
    }
    rows.push(...page.data.rows);
    total = page.data.total;
  }

  if (total !== null) return { rows, total, pending, error };
  if (error) return { rows: [], total: 0, pending: false, error };
  return undefined;
}

/** How many pages a node wants with `loaded` rows answered and more due. */
export function pagesWanted(loaded: number): number {
  return Math.floor(loaded / PAGE_SIZE) + 1;
}

/** `expanded` with `key` added or removed. */
export function toggled(expanded: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(expanded);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** One level of depth, as the guide draws it. Characters, because the tree is mono. */
export const INDENT = "2ch";

/** Past this depth the indentation stops and the guides stack. */
export const MAX_INDENT_DEPTH = 8;

/** The narrowest the name column goes, so a shallow list is not cramped. */
const MIN_NAME_COLS = 22;

/** The widest, so one long name cannot push every value off the pane. */
const MAX_NAME_COLS = 52;

/**
 * How many characters the name column needs to hold every row without eliding.
 *
 * The tree is set in one mono face, so a character is a fixed advance and the widest
 * row is arithmetic rather than a measurement. One width for the whole list is what
 * keeps the values in a column, and taking it from the loaded rows rather than the
 * visible ones is what stops it moving while a reader scrolls.
 */
export function nameColumns(
  visible: readonly VisibleRow[],
  tagOf: (row: BinRow) => string | null,
): number {
  let widest = MIN_NAME_COLS;
  for (const line of visible) {
    /* An object and an element sit outside the column, so neither widens it. */
    if (line.kind !== "row" || line.row.node === "object" || line.row.node === "element") continue;
    const tag = tagOf(line.row);
    const held = line.row.value.type === "struct" ? (line.row.value.class ?? "") : "";
    const cols =
      Math.min(line.depth, MAX_INDENT_DEPTH) * 2 +
      line.row.name.length +
      (tag === null ? 0 : tag.length + 1) +
      (held === "" ? 0 : held.length + 1);
    if (cols > widest) widest = cols;
  }
  return Math.min(widest, MAX_NAME_COLS);
}
