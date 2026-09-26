import { m } from "@/i18n";
import type {
  DeclarationsLayer,
  DeclaredEntry,
  DeclaredKey,
  DeclaredLinks,
  DeclaredModule,
  LineSpan,
} from "@/lib/tauri";

interface LayerNode {
  type: "layer";
  id: string;
  layer: DeclarationsLayer;
}

interface ModuleNode {
  type: "module";
  id: string;
  layer: string;
  module: DeclaredModule;
}

interface EntryNode {
  type: "entry";
  id: string;
  layer: string;
  module: DeclaredModule;
  entry: DeclaredEntry;
}

interface KeyNode {
  type: "key";
  id: string;
  layer: string;
  module: DeclaredModule;
  entry: DeclaredEntry;
  key: DeclaredKey;
}

interface LinkNode {
  type: "link";
  id: string;
  layer: string;
  module: DeclaredModule;
  /** The entry of an `entries` module whose chunks the link edits, null for a `target` module. */
  entry: DeclaredEntry | null;
  sign: "add" | "remove";
  path: string;
}

interface OverrideNode {
  type: "override";
  id: string;
  layer: string;
  module: DeclaredModule;
  path: string;
}

/** The line under a module that declares nothing yet. */
interface EmptyNode {
  type: "empty";
  id: string;
  layer: string;
  module: DeclaredModule;
}

/** The line that adds a module at the end of a layer's manifest. */
interface AddNode {
  type: "add";
  id: string;
  layer: string;
}

/** One item of a declarations outline: a layer, a module, or something a module declares. */
export type OutlineNode =
  | LayerNode
  | ModuleNode
  | EntryNode
  | KeyNode
  | LinkNode
  | OverrideNode
  | EmptyNode
  | AddNode;

/** One row of a flattened outline, and how deep it sits. */
export interface OutlineRow {
  node: OutlineNode;
  depth: number;
}

/** What a flattened outline draws. */
export interface OutlineShape {
  /** Draw each layer as a row above its modules. Off where one layer fills the view. */
  layers: boolean;
  /** Draw each entry's keys and links, and each module's links and overrides. */
  keys: boolean;
  /** Draw a New module line at the end of every layer, a layer with no manifest included. */
  adds: boolean;
}

export function layerItemId(layer: string): string {
  return `layer:${layer}`;
}

export function moduleItemId(layer: string, module: number): string {
  return `module:${layer}:${module}`;
}

/** An entry by its position in the module's list, which a repeated name cannot confuse. */
export function entryItemId(layer: string, module: number, position: number): string {
  return `entry:${layer}:${module}:${position}`;
}

export function keyItemId(layer: string, module: number, position: number, key: number): string {
  return `key:${layer}:${module}:${position}:${key}`;
}

/** A link by its entry's position, `-1` for a module's own, its sign and its place in the list. */
export function linkItemId(
  layer: string,
  module: number,
  position: number,
  sign: LinkNode["sign"],
  at: number,
): string {
  return `link:${layer}:${module}:${position}:${sign}:${at}`;
}

export function overrideItemId(layer: string, module: number, at: number): string {
  return `override:${layer}:${module}:${at}`;
}

export function emptyItemId(layer: string, module: number): string {
  return `empty:${layer}:${module}`;
}

export function addItemId(layer: string): string {
  return `add:${layer}`;
}

/** A module's own name, or its place in the manifest where it spells none. */
export function moduleTitle(module: DeclaredModule): string {
  return module.name ?? m.workshop_declarations_module_title({ number: module.index + 1 });
}

/** How many keys a module declares, over every entry. */
export function moduleKeyCount(module: DeclaredModule): number {
  return module.entries.reduce((total, entry) => total + entry.keys.length, 0);
}

/** What a module declares, counted for its summary line. */
export interface ModuleTally {
  /** Entries whose properties the module edits. */
  edited: number;
  created: number;
  removed: number;
  keys: number;
  links: number;
  overrides: number;
}

export function moduleTally(module: DeclaredModule): ModuleTally {
  const tally: ModuleTally = {
    edited: 0,
    created: 0,
    removed: 0,
    keys: 0,
    links: linkCount(module.links),
    overrides: module.overrides.length,
  };

  for (const entry of module.entries) {
    tally.keys += entry.keys.length;
    tally.links += linkCount(entry.links);

    if (entry.object === null) tally.edited += 1;
    else if (entry.object.kind === "remove") tally.removed += 1;
    else tally.created += 1;
  }

  return tally;
}

function linkCount(links: DeclaredLinks): number {
  return links.add.length + links.remove.length;
}

/** Whether a game bin declares the entry, which one the module creates is not. */
export function isInGame(entry: DeclaredEntry): boolean {
  return entry.object === null || entry.object.kind === "remove";
}

/** The name an entry reads as: the path the tables know for a hash, else its spelling. */
export function entryTitle(entry: DeclaredEntry): string {
  return entry.knownName ?? entry.name;
}

/** The widest a key's path column grows, in characters, before a path truncates. */
const PATH_COLUMN_MAX = 56;

/** The width of the path column every key's value lines up after, in characters. */
export function pathColumn(layers: readonly DeclarationsLayer[]): number {
  const keys = layers
    .flatMap((layer) => layer.modules)
    .flatMap((module) => module.entries)
    .flatMap((entry) => entry.keys);
  const widest = keys.reduce((most, key) => Math.max(most, key.key.length), 0);

  return Math.min(widest, PATH_COLUMN_MAX);
}

/** Where in the manifest's text an item is, or null for one outside it. */
export function itemSpan(node: OutlineNode): LineSpan | null {
  switch (node.type) {
    case "layer":
      return node.layer.error?.span ?? null;
    case "module":
      return node.module.span;
    case "entry":
      return node.entry.span;
    case "key":
      return node.key.span;
    case "link":
      return node.entry?.span ?? node.module.span;
    case "override":
    case "empty":
      return node.module.span;
    case "add":
      return null;
  }
}

/** Whether a node folds: a layer, a module, and an entry only where its body is drawn. */
export function isBranch(node: OutlineNode, shape: OutlineShape): boolean {
  switch (node.type) {
    case "layer":
    case "module":
      return true;
    case "entry":
      return shape.keys && entryChildren(node.entry) > 0;
    default:
      return false;
  }
}

function entryChildren(entry: DeclaredEntry): number {
  return entry.keys.length + linkCount(entry.links);
}

/**
 * The outline of `layers` as rows, a shut branch's children left out.
 *
 * A layer with no manifest draws no row, since it declares nothing, unless the shape adds
 * modules. Under a module, overrides come first and links last, the order a build applies them
 * in.
 */
export function flattenOutline(
  layers: readonly DeclarationsLayer[],
  isShut: (id: string) => boolean,
  shape: OutlineShape,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const base = shape.layers ? 1 : 0;

  for (const layer of layers) {
    if (layer.file === null && !shape.adds) continue;

    const layerId = layerItemId(layer.layer);
    if (shape.layers) {
      rows.push({ node: { type: "layer", id: layerId, layer }, depth: 0 });
      if (isShut(layerId)) continue;
    }

    for (const module of layer.modules) {
      pushModule(rows, layer.layer, module, isShut, shape, base);
    }

    /* A manifest that does not load takes no module action. */
    if (shape.adds && layer.error === null) {
      const node = { type: "add" as const, id: addItemId(layer.layer), layer: layer.layer };
      rows.push({ node, depth: base });
    }
  }

  return rows;
}

function pushModule(
  rows: OutlineRow[],
  layer: string,
  module: DeclaredModule,
  isShut: (id: string) => boolean,
  shape: OutlineShape,
  depth: number,
): void {
  const id = moduleItemId(layer, module.index);
  rows.push({ node: { type: "module", id, layer, module }, depth });
  if (isShut(id)) return;

  if (shape.keys) {
    module.overrides.forEach((path, at) => {
      rows.push({
        node: {
          type: "override",
          id: overrideItemId(layer, module.index, at),
          layer,
          module,
          path,
        },
        depth: depth + 1,
      });
    });
  }

  module.entries.forEach((entry, position) => {
    const entryId = entryItemId(layer, module.index, position);
    rows.push({ node: { type: "entry", id: entryId, layer, module, entry }, depth: depth + 1 });
    if (!shape.keys || isShut(entryId)) return;

    entry.keys.forEach((key, at) => {
      rows.push({
        node: {
          type: "key",
          id: keyItemId(layer, module.index, position, at),
          layer,
          module,
          entry,
          key,
        },
        depth: depth + 2,
      });
    });
    pushLinks(rows, layer, module, entry, position, depth + 2);
  });

  if (shape.keys) pushLinks(rows, layer, module, null, -1, depth + 1);

  const declares = module.entries.length + module.overrides.length + linkCount(module.links) > 0;
  if (shape.keys && !declares) {
    rows.push({
      node: { type: "empty", id: emptyItemId(layer, module.index), layer, module },
      depth: depth + 1,
    });
  }
}

function pushLinks(
  rows: OutlineRow[],
  layer: string,
  module: DeclaredModule,
  entry: DeclaredEntry | null,
  position: number,
  depth: number,
): void {
  const links = entry?.links ?? module.links;
  const push = (sign: LinkNode["sign"], path: string, at: number) => {
    rows.push({
      node: {
        type: "link",
        id: linkItemId(layer, module.index, position, sign, at),
        layer,
        module,
        entry,
        sign,
        path,
      },
      depth,
    });
  };

  links.remove.forEach((path, at) => push("remove", path, at));
  links.add.forEach((path, at) => push("add", path, at));
}

/** The ids of every branch above `id`, which a reveal opens. */
export function ancestorIds(id: string): string[] {
  const [type, layer, ...rest] = id.split(":");
  if (layer === undefined || type === "layer") return [];

  const ancestors = [layerItemId(layer)];
  const [module, position] = rest;
  if (type === "module" || module === undefined) return ancestors;

  ancestors.push(moduleItemId(layer, Number(module)));
  if (type === "entry" || type === "override" || type === "empty" || position === undefined) {
    return ancestors;
  }
  if (Number(position) < 0) return ancestors;

  ancestors.push(entryItemId(layer, Number(module), Number(position)));
  return ancestors;
}

/**
 * The property path's segments, split at the dots outside a `{key}` or a quote.
 *
 * `skinMeshProperties.OutlineCategorySubmeshes` reads as two, and `a{"b.c"}.d` as two.
 */
export function pathSegments(path: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let at = 0; at < path.length; at += 1) {
    const char = path[at]!;
    if (quote !== null) {
      if (char === "\\") at += 1;
      else if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === "." && depth === 0) {
      segments.push(path.slice(start, at));
      start = at + 1;
    }
  }

  segments.push(path.slice(start));
  return segments;
}

/** The ids of every branch the outline of `layers` draws, with nothing collapsed. */
export function outlineBranchIds(
  layers: readonly DeclarationsLayer[],
  shape: OutlineShape,
): string[] {
  return flattenOutline(layers, () => false, shape)
    .filter((row) => isBranch(row.node, shape))
    .map((row) => row.node.id);
}

/**
 * `collapsed` with the branch `id` and every branch below it toggled together.
 *
 * A collapsed `id` expands with all of `branches` below it, and an expanded one collapses with
 * them.
 */
export function toggleOutlineSubtree(
  collapsed: ReadonlySet<string>,
  id: string,
  branches: readonly string[],
): ReadonlySet<string> {
  const subtree = [id, ...branches.filter((branch) => ancestorIds(branch).includes(id))];
  const next = new Set(collapsed);

  if (collapsed.has(id)) {
    for (const branch of subtree) {
      next.delete(branch);
    }
  } else {
    for (const branch of subtree) {
      next.add(branch);
    }
  }

  return next;
}
