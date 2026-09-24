import type {
  AppError,
  BinDocumentId,
  BinRow,
  BinRows,
  BinValue,
  Dependency,
  PropertyKind,
  RowNode,
} from "@/lib/tauri";

import { nameHash } from "../../shared/utils/binHash";
import type { ObjectDraft } from "../state/newObject";

/** How many rows one children call answers. A longer container asks again. */
export const PAGE_SIZE = 500;

/** The key a row is expanded, fetched and drawn under: its entry and its wire path. */
export function rowKey(row: Pick<BinRow, "entry" | "path">): string {
  return `${row.entry}:${row.path}`;
}

/** The class a depth-zero row is sorted under, and null for a row that states none. */
function rootClass(row: BinRow): string | null {
  return row.value.type === "struct" ? (row.value.class ?? row.value.classHash) : null;
}

/** Named before unnamed, then by the text itself, digits by their value. */
function byText(a: string, aUnnamed: boolean, b: string, bUnnamed: boolean): number {
  if (aUnnamed !== bUnnamed) return aUnnamed ? 1 : -1;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * A file's depth-zero rows in the order its tree lists them: objects ahead of patch
 * targets, each run by class and then by name.
 *
 * A file keeps its objects in the order its hash table fell out in, which says nothing to
 * a reader. A class or an object no table names sorts after the named ones, by its hash.
 */
export function sortedRoots(rows: readonly BinRow[]): BinRow[] {
  return rows
    .map((row) => ({ row, class: rootClass(row) }))
    .sort((a, b) => {
      const targets = Number(a.row.node === "target") - Number(b.row.node === "target");
      if (targets !== 0) return targets;
      const classes = byText(
        a.class ?? "",
        a.row.value.type === "struct" && a.row.value.class === null,
        b.class ?? "",
        b.row.value.type === "struct" && b.row.value.class === null,
      );
      if (classes !== 0) return classes;
      return byText(a.row.name, a.row.unnamed, b.row.name, b.row.unnamed);
    })
    .map(({ row }) => row);
}

/** The key of the object row an entry hash names. */
export function objectKey(entry: string): string {
  return `${entry}:`;
}

/** The wire path of a target row, which holds the patch records of one object. ADR-0041. */
export const TARGET_PATH = "#";

/** The key of the target row an entry hash names. */
export function targetKey(entry: string): string {
  return `${entry}:${TARGET_PATH}`;
}

/**
 * The hash of the field a patch record's path ends in, or null where it ends in a subscript.
 *
 * The record writes its path as text, so the name hashes as the game hashes it.
 */
export function recordField(path: string): string | null {
  const last = path.slice(path.lastIndexOf(".") + 1);
  return /^\w+$/.test(last) ? nameHash(last) : null;
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
 * not under `[30]`, and `#1` is not under `#10`. Everything of an object sits under the
 * object's own key, and every record of a target under the target's (ADR-0041).
 */
export function isUnder(parent: string, key: string): boolean {
  if (key === parent) return true;
  if (!key.startsWith(parent)) return false;
  const next = key[parent.length] ?? "";
  if (parent.endsWith(`:${TARGET_PATH}`)) return next >= "0" && next <= "9";
  if (parent.endsWith(":")) return next !== TARGET_PATH;
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
export function canExpand(row: BinRow, editable = false): boolean {
  /* An editable holder opens while empty, which is where its add line draws. */
  if (editable && lineTarget(row.value) !== null) return true;
  return holdsChildren(row.value);
}

/** What an add line under a holder writes into it. */
export type LineTarget =
  | { readonly kind: "property" }
  | { readonly kind: "item"; readonly itemKind: PropertyKind }
  /** The value of an absent option. */
  | { readonly kind: "option"; readonly itemKind: PropertyKind }
  | { readonly kind: "entry"; readonly keyKind: PropertyKind; readonly valueKind: PropertyKind }
  /** The class of a null pointer. */
  | { readonly kind: "pointer" }
  /** A new object of the file, named on the line. ADR-0049. */
  | { readonly kind: "object"; readonly draft: ObjectDraft }
  /** A new dependency of the file, typed as a path or its brex spelling. */
  | { readonly kind: "dependency" };

/** What an add line under a row holding `value` writes, or null where it takes none. */
export function lineTarget(value: BinValue): LineTarget | null {
  switch (value.type) {
    case "struct":
      return { kind: "property" };
    case "container":
      return { kind: "item", itemKind: value.itemKind };
    case "map":
      return { kind: "entry", keyKind: value.keyKind, valueKind: value.valueKind };
    case "optional":
      return value.present ? null : { kind: "option", itemKind: value.itemKind };
    case "null":
      return { kind: "pointer" };
    default:
      return null;
  }
}

/** Whether a value of `kind` is a struct, whose class an add picks. */
export function holdsClass(kind: string): boolean {
  return kind === "pointer" || kind === "embed";
}

/** How many rows sit under `row`, which is what reading it costs. */
export function childCount(row: BinRow): number {
  const { value } = row;
  switch (value.type) {
    case "struct":
    case "container":
    case "map":
    case "records":
      return value.len;
    case "optional":
      return value.present ? 1 : 0;
    default:
      return 0;
  }
}

/**
 * Every key on the way down to `key`, the object's or the target's own first and `key`
 * itself last.
 *
 * A reveal opens each of them, so a row nested under a container is on screen once
 * every level has answered. A path this cannot read answers what it reached.
 */
export function ancestorKeys(key: string): string[] {
  const [entry, path] = splitKey(key);
  const record = path.startsWith(TARGET_PATH);
  const keys = [record ? targetKey(entry) : objectKey(entry)];
  let at = record ? recordEnd(path) : 0;
  if (record && at > TARGET_PATH.length) keys.push(`${entry}:${path.slice(0, at)}`);
  while (at < path.length) {
    const end = segmentEnd(path, at);
    if (end === null) break;
    at = end;
    keys.push(`${entry}:${path.slice(0, at)}`);
  }
  if (keys.at(-1) !== key) keys.push(key);
  return keys;
}

/**
 * The page a reveal waits on: the open level whose answered rows end before the next key
 * down, and how many rows it holds.
 *
 * `ancestors` are the keys down to the row, outermost first. Null while a level has not
 * answered, while its next page is on its way, and once every level holds its next key.
 */
export function revealPage(
  ancestors: readonly string[],
  childrenOf: (key: string) => LoadedChildren | undefined,
): { readonly parent: string; readonly loaded: number } | null {
  for (let at = 0; at + 1 < ancestors.length; at += 1) {
    const parent = ancestors[at]!;
    const children = childrenOf(parent);
    if (children === undefined) return null;
    const next = ancestors[at + 1];
    if (children.rows.some((row) => rowKey(row) === next)) continue;
    if (children.pending || children.error || children.rows.length >= children.total) return null;
    return { parent, loaded: children.rows.length };
  }
  return null;
}

/** Where the segment starting at `at` ends, or null for a path this cannot read. */
function segmentEnd(path: string, at: number): number | null {
  if (path[at] === "[") {
    const close = path.indexOf("]", at);
    return close < 0 ? null : close + 1;
  }
  if (path[at] === "{") {
    const end = keyEnd(path, at + 1);
    return end === null ? null : repeatEnd(path, end);
  }

  /* A field is eight hex digits, and every one but the first opens with a dot. */
  const start = path[at] === "." ? at + 1 : at;
  return start + 8 <= path.length ? start + 8 : null;
}

/** Where the record position of a record path ends: the digits after its `#`. */
function recordEnd(path: string): number {
  let end = TARGET_PATH.length;
  while (end < path.length && path[end]! >= "0" && path[end]! <= "9") end += 1;
  return end;
}

/** Where a repeated key's `#n` starting at `at` ends, or `at` where the key takes none. */
function repeatEnd(path: string, at: number): number {
  if (path[at] !== "#") return at;
  let end = at + 1;
  while (end < path.length && path[end]! >= "0" && path[end]! <= "9") end += 1;
  return end;
}

/**
 * Whether an entry row repeats the key of an earlier entry of its map.
 *
 * The backend writes the later entries of one key as `{key}#n`, so each has a path.
 */
export function repeatsKey(row: Pick<BinRow, "node" | "path">): boolean {
  return row.node === "entry" && /}#\d+$/.test(row.path);
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
    case "records":
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
      /** The row this one is a child of. Null at depth zero. */
      readonly parent: BinRow | null;
      /** The row's position among its parent's children. */
      readonly index: number;
    }
  | {
      readonly kind: "more";
      readonly key: string;
      readonly parent: string;
      readonly depth: number;
      readonly loaded: number;
      readonly total: number;
      readonly pending: boolean;
    }
  | {
      /** The pinned row the header's dependencies fold under. */
      readonly kind: "dependencies";
      readonly key: string;
      readonly depth: 0;
      readonly count: number;
      readonly expanded: boolean;
    }
  | {
      /** One dependency of the header, `index` in its list. */
      readonly kind: "dependency";
      readonly key: string;
      readonly depth: 1;
      readonly index: number;
      readonly dependency: Dependency;
      /** How many dependencies the list holds, the ones a declared layer removes included. */
      readonly count: number;
    }
  | {
      readonly kind: "add";
      readonly key: string;
      readonly document: BinDocumentId;
      /** The holder's object, `0x` and eight hex digits. */
      readonly entry: string;
      /** The holder's wire path, empty for the object itself. */
      readonly path: string;
      readonly depth: number;
      readonly target: LineTarget;
      /** Where an item inserts in its list or map. Null for the end. */
      readonly index: number | null;
    };

/** The line a row draws as. */
export type RowLine = Extract<VisibleRow, { kind: "row" }>;

/** The line a property, an item, a key or a class is typed into, under an editable holder. */
export type AddLine = Extract<VisibleRow, { kind: "add" }>;

/** The key of the add line under the holder `holderKey`, or of its insert line at `index`. */
export function addLineKey(holderKey: string, index: number | null = null): string {
  return index === null ? `${holderKey}:add` : `${holderKey}:add@${index}`;
}

/** An insert line opened inside a list or a map, before the child at `index`. */
export interface InsertAt {
  readonly holder: string;
  readonly index: number;
}

/** Where add lines draw: the document they add to, and the object an object tab's roots belong to. */
export interface AddLines {
  readonly document: BinDocumentId;
  /** The object whose properties the roots are, for an add line after them. Null for a file's roots. */
  readonly rootEntry: string | null;
  /** The one insert line open, if any. */
  readonly insertAt?: InsertAt | null;
  /** The new object being named, whose line follows a file's roots. */
  readonly newObject?: ObjectDraft | null;
}

/** The key of the line a new object is named on. */
export const NEW_OBJECT_KEY = "new-object:add";

/**
 * The key of the pinned dependencies row, shaped as an object's key so the guides read it.
 * No entry hash spells `dependencies`, so no object row shares it.
 */
export const DEPENDENCIES_KEY = "dependencies:";

/** The key of the line a new dependency is typed on. */
export const DEPENDENCY_ADD_KEY = addLineKey(DEPENDENCIES_KEY);

/** The key of the dependency at `index`. */
export function dependencyKey(index: number): string {
  return `${DEPENDENCIES_KEY}${index}`;
}

/** The header's dependencies as the tree pins them over its roots. */
export interface DependencyLines {
  readonly list: readonly Dependency[];
  readonly document: BinDocumentId;
}

/**
 * The lines the list draws, in order, out of the root rows and what is fetched under
 * the expanded ones.
 *
 * The frontend keeps the expansion state and the backend answers one node's children at
 * a time (ADR-0026). A node expanded before its children answer draws as loading. A node
 * with more rows than answered draws a request for the rest under what it has.
 * `rootOwner` is the class the roots are properties of, which an object tab's roots are.
 * `dependencies` pins the header's list over the roots, folded under one row.
 */
export function flattenRows(
  roots: readonly BinRow[],
  expanded: ReadonlySet<string>,
  childrenOf: (key: string) => LoadedChildren | undefined,
  rootOwner: string | null = null,
  adds: AddLines | null = null,
  dependencies: DependencyLines | null = null,
): VisibleRow[] {
  const out: VisibleRow[] =
    dependencies === null ? [] : dependencyLines(dependencies, expanded, adds !== null);
  const editable = adds !== null;
  const insertAt = adds?.insertAt ?? null;

  function addLine(holder: BinRow, target: LineTarget, depth: number, index: number | null) {
    if (adds === null) return;
    out.push({
      kind: "add",
      key: addLineKey(rowKey(holder), index),
      document: adds.document,
      entry: holder.entry,
      path: holder.path,
      depth,
      target,
      index,
    });
  }

  function visit(
    rows: readonly BinRow[],
    depth: number,
    owner: string | null,
    parent: BinRow | null,
  ) {
    const parentKey = parent === null ? null : rowKey(parent);
    const parentTarget = parent === null ? null : lineTarget(parent.value);
    rows.forEach((row, index) => {
      const key = rowKey(row);
      const isExpanded = expanded.has(key) && canExpand(row, editable);
      const children = isExpanded ? childrenOf(key) : undefined;
      out.push({
        kind: "row",
        key,
        row,
        depth,
        expanded: isExpanded,
        loading: isExpanded && children === undefined,
        owner: row.node === "property" ? owner : null,
        parent,
        index,
      });

      if (children) {
        visit(children.rows, depth + 1, ownerOf(row), row);
        const target = lineTarget(row.value);
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
        } else if (target !== null && !children.pending) {
          addLine(row, target, depth + 1, null);
        }
      }

      if (
        parent !== null &&
        parentTarget !== null &&
        insertAt?.holder === parentKey &&
        insertAt.index === index + 1
      ) {
        addLine(parent, parentTarget, depth, index + 1);
      }
    });
  }

  visit(roots, 0, rootOwner, null);
  if (adds !== null && adds.rootEntry !== null) {
    out.push({
      kind: "add",
      key: addLineKey(objectKey(adds.rootEntry)),
      document: adds.document,
      entry: adds.rootEntry,
      path: "",
      depth: 0,
      target: { kind: "property" },
      index: null,
    });
  }
  if (adds?.newObject && adds.rootEntry === null) {
    out.push({
      kind: "add",
      key: NEW_OBJECT_KEY,
      document: adds.document,
      entry: "",
      path: "",
      depth: 0,
      target: { kind: "object", draft: adds.newObject },
      index: null,
    });
  }
  return out;
}

/** The pinned dependencies row, and under it when open each dependency and the add line. */
function dependencyLines(
  { list, document }: DependencyLines,
  expanded: ReadonlySet<string>,
  editable: boolean,
): VisibleRow[] {
  const open = expanded.has(DEPENDENCIES_KEY);
  const out: VisibleRow[] = [
    { kind: "dependencies", key: DEPENDENCIES_KEY, depth: 0, count: list.length, expanded: open },
  ];
  if (!open) return out;

  list.forEach((dependency, index) => {
    out.push({
      kind: "dependency",
      key: dependencyKey(index),
      depth: 1,
      index,
      dependency,
      count: list.length,
    });
  });
  if (editable) {
    out.push({
      kind: "add",
      key: DEPENDENCY_ADD_KEY,
      document,
      entry: "",
      path: "",
      depth: 1,
      target: { kind: "dependency" },
      index: null,
    });
  }
  return out;
}

/** An index map over a list's items: where the item at an index went, or null where it went out. */
export type IndexShift = (index: number) => number | null;

/** The items at and after `at` move down one, for an item put in at `at`. */
export function insertShift(at: number): IndexShift {
  return (index) => (index >= at ? index + 1 : index);
}

/** The item at `at` goes out and the items after it move up one. */
export function removeShift(at: number): IndexShift {
  return (index) => {
    if (index === at) return null;
    return index > at ? index - 1 : index;
  };
}

/** The item at `from` lands at `to`, and the items between close up behind it. */
export function moveShift(from: number, to: number): IndexShift {
  return (index) => {
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (from > to && index >= to && index < from) return index + 1;
    return index;
  };
}

/**
 * `key` with the index of the item it sits under in the list `holder` passed through
 * `shift`, or null where that item went out. A key outside the list comes back as it was.
 */
export function shiftedKey(key: string, holder: string, shift: IndexShift): string | null {
  const prefix = `${holder}[`;
  if (!key.startsWith(prefix)) return key;
  const close = key.indexOf("]", prefix.length);
  const index = Number(key.slice(prefix.length, close));
  if (close < 0 || !Number.isInteger(index)) return key;
  const next = shift(index);
  if (next === null) return null;
  return `${prefix}${next}${key.slice(close)}`;
}

/** `key` moved from under `from` to under `to`, where it sits under `from`. */
export function renamedKey(key: string, from: string, to: string): string {
  return isUnder(from, key) ? `${to}${key.slice(from.length)}` : key;
}

/** Drop every key under `gone`, for an edit that took it out. */
export function droppedUnder(gone: string): (key: string) => string | null {
  return (key) => (isUnder(gone, key) ? null : key);
}

/** Drop every key strictly under `holder`, keeping `holder` itself. */
export function droppedInside(holder: string): (key: string) => string | null {
  return (key) => (key !== holder && isUnder(holder, key) ? null : key);
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

/** The key of the row a line hangs under, which names the block its innermost guide draws. */
export function lineParent(line: VisibleRow): string | null {
  if (line.depth === 0) return null;
  switch (line.kind) {
    case "row":
      return line.parent === null ? null : rowKey(line.parent);
    case "more":
      return line.parent;
    case "add":
      return line.target.kind === "dependency" ? DEPENDENCIES_KEY : rowKey(line);
    case "dependencies":
      return null;
    case "dependency":
      return DEPENDENCIES_KEY;
  }
}

/**
 * The block each guide of a line belongs to, outermost first: the key of the row at that depth.
 *
 * `parent` is the row the line hangs under, at `depth - 1`. A guide is one block's edge, so
 * every line under that row draws the same key at the same level.
 */
export function guideBlocks(parent: string | null, depth: number): string[] {
  if (parent === null || depth === 0) return [];
  const chain = ancestorKeys(parent);
  const top = chain.length - depth;
  return Array.from({ length: depth }, (_, level) => chain[top + level] ?? "");
}

/** Whether a row of `node` draws its name outside the name column. */
export function outsideColumn(node: RowNode): boolean {
  return node === "object" || node === "target" || node === "element";
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
    /* An object, a target and an element sit outside the column, so none widens it. */
    if (line.kind !== "row" || outsideColumn(line.row.node)) continue;
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
