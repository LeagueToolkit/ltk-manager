/**
 * The tree the objects browser draws over the install's object paths.
 *
 * Pure, and read off the backend's per-prefix listings and the project's content scan.
 * "Objects browser" in docs/ux/PROJECT_EDITOR.md.
 */

import type {
  ContentTree,
  ObjectDeclaration,
  ObjectDirListing,
  ObjectFindHit,
  ObjectNodeEntry,
  WorkshopProject,
} from "@/lib/tauri";

import { layerTitle } from "../../documents/utils/contentDocument";
import type { MatchRange } from "../../palette/utils/matcher";
import { compareNames } from "../../shared/utils/naturalOrder";

/** The prefix of the group holding the objects no table names, as the backend keys it. */
export const UNNAMED_PREFIX = "?";

/** A layer of the project, as a row marks it: the name on disk and the title on screen. */
export interface LayerMark {
  readonly name: string;
  readonly title: string;
}

export type ObjectTreeNode = ObjectPrefixNode | ObjectRowNode | ObjectLoadingNode | ObjectMoreNode;

/** A path no object bears, folded through any run of single-child prefixes. */
export interface ObjectPrefixNode {
  readonly type: "prefix";
  /** The folded node's path, which keys its expansion and its listing. */
  readonly id: string;
  /** The folded run of segments joined by "/". */
  readonly name: string;
  /** The group of the objects no table names. */
  readonly unnamed: boolean;
  /** Objects below the prefix. */
  readonly count: number;
  readonly children: readonly ObjectTreeNode[];
}

/** An object, and the prefix of everything under its path. */
export interface ObjectRowNode {
  readonly type: "object";
  /** The object's path, which keys its expansion and its listing. */
  readonly id: string;
  readonly path: string;
  /** The last segment, or the hash where no table names the object. */
  readonly name: string;
  /** `0x` and eight hex digits. */
  readonly objectHash: string;
  /** The path is a hash no table names. */
  readonly unnamed: boolean;
  /** The install's declarations in archive order, then the project's layers'. */
  readonly declarations: readonly ObjectDeclaration[];
  /** The layers declaring the object, for the row's mark. */
  readonly layers: readonly LayerMark[];
  /** Objects below the node. */
  readonly count: number;
  /** The runs a find marked on `path`. */
  readonly ranges?: readonly MatchRange[];
  /** The path children. */
  readonly children: readonly ObjectTreeNode[];
}

/** Stands in for an expanded node whose listing is in flight. */
export interface ObjectLoadingNode {
  readonly type: "loading";
  readonly id: string;
}

/** The hits the cap left out, as the last row of a find. */
export interface ObjectMoreNode {
  readonly type: "more";
  readonly id: string;
  readonly count: number;
}

/** One declaration a layer of the project holds, with the layer. */
export interface LayerDeclaration {
  readonly declaration: ObjectDeclaration;
  readonly layer: LayerMark;
}

/** The project's declarations by object hash. */
export type LayerDeclarations = ReadonlyMap<string, readonly LayerDeclaration[]>;

export const NO_LAYER_DECLARATIONS: LayerDeclarations = new Map();

/**
 * Every object the project's layers declare, by hash, out of the content scan.
 *
 * The layer side of "A node with several declarations" in docs/ux/PROJECT_EDITOR.md.
 */
export function layerDeclarationsOf(
  tree: ContentTree | undefined,
  project: WorkshopProject,
): LayerDeclarations {
  const declared = new Map<string, LayerDeclaration[]>();
  if (!tree) return declared;
  for (const layer of tree.layers) {
    const mark: LayerMark = { name: layer.name, title: layerTitle(project, layer.name) };
    for (const entry of layer.entries) {
      for (const object of entry.objects) {
        const declaration: ObjectDeclaration = {
          asset: {
            kind: "layer",
            project: project.path,
            layer: layer.name,
            path: entry.relativePath,
          },
          file: entry.relativePath,
          classHash: object.classHash,
          class: object.class,
        };
        const known = declared.get(object.objectHash);
        if (known) known.push({ declaration, layer: mark });
        else declared.set(object.objectHash, [{ declaration, layer: mark }]);
      }
    }
  }
  return declared;
}

/** Whether a row has children to open: every prefix, and an object with objects under it. */
export function expandable(node: ObjectTreeNode): node is ObjectPrefixNode | ObjectRowNode {
  if (node.type === "prefix") return true;
  if (node.type === "object") return node.count > 0;
  return false;
}

/** What a click on a row's body or its caret does. */
export type Activation = "open" | "toggle" | "none";

/**
 * The click rule: a prefix toggles, an object opens, and a node that is both opens from
 * its body and toggles from its caret alone.
 */
export function activation(node: ObjectTreeNode, on: "row" | "caret"): Activation {
  switch (node.type) {
    case "prefix":
      return "toggle";
    case "object":
      return on === "caret" && expandable(node) ? "toggle" : "open";
    default:
      return "none";
  }
}

/**
 * Materialize the part of the lazily-read object tree that is on screen.
 *
 * `listings` maps a prefix to what it holds, or to null for a fetch in flight.
 * The root is the entry under `""`. An expanded object whose listing has not arrived
 * carries a loading row.
 */
export function buildObjectTree(
  listings: ReadonlyMap<string, ObjectDirListing | null>,
  isExpanded: (path: string) => boolean,
  layers: LayerDeclarations,
): ObjectTreeNode[] {
  const build = (path: string): ObjectTreeNode[] => {
    const listing = listings.get(path);
    if (!listing) return [{ type: "loading", id: `l:${path}` }];

    return objectListingNodes(listing, layers, (path) => (isExpanded(path) ? build(path) : []));
  };

  return build("");
}

/** One object directory, independent of its tree or grid presentation. */
export function objectListingNodes(
  listing: ObjectDirListing,
  layers: LayerDeclarations,
  childrenOf: (path: string) => readonly ObjectTreeNode[] = () => [],
): (ObjectPrefixNode | ObjectRowNode)[] {
  const prefixes = listing.prefixes.map<ObjectPrefixNode>((prefix) => ({
    type: "prefix",
    id: prefix.path,
    name: prefix.name,
    unnamed: prefix.path === UNNAMED_PREFIX,
    count: prefix.count,
    children: childrenOf(prefix.path),
  }));

  const objects = listing.objects.map((entry) => {
    const below = entry.count > 0 ? childrenOf(entry.path) : [];
    return objectNode(entry, layers, below);
  });

  return [...prefixes, ...objects];
}

/** The row of `entry`, its declarations joined with the layers', over `below`. */
function objectNode(
  entry: ObjectNodeEntry,
  layers: LayerDeclarations,
  below: readonly ObjectTreeNode[],
  ranges?: readonly MatchRange[],
): ObjectRowNode {
  const fromLayers = layers.get(entry.objectHash) ?? [];

  return {
    type: "object",
    id: entry.path,
    path: entry.path,
    name: entry.name,
    objectHash: entry.objectHash,
    unnamed: entry.path === entry.objectHash,
    declarations: [...entry.declarations, ...fromLayers.map((declared) => declared.declaration)],
    layers: fromLayers.map((declared) => declared.layer),
    count: entry.count,
    ranges,
    children: below,
  };
}

/** One node of the trie a find's hits are folded through. */
interface HitNode {
  name: string;
  path: string;
  children: Map<string, HitNode>;
  hit: ObjectFindHit | null;
}

/**
 * The tree a find leaves: every hit under its real prefixes.
 *
 * The hits arrive flat and in path order. Prefixes no hit sits at fold the way the browse
 * tree's do, the unnamed gather under `?` last, and a `more` row closes the list where the
 * cap trimmed `total`. Every node starts expanded. The hits are what the pattern was typed
 * to see. `isExpanded` answers for every object row.
 */
export function buildFindTree(
  hits: readonly ObjectFindHit[],
  total: number,
  layers: LayerDeclarations,
  isExpanded: (path: string) => boolean,
): ObjectTreeNode[] {
  const root: HitNode = { name: "", path: "", children: new Map(), hit: null };
  const unnamed: ObjectFindHit[] = [];

  for (const hit of hits) {
    if (hit.path === hit.objectHash) {
      unnamed.push(hit);
      continue;
    }
    let cursor = root;
    for (const segment of hit.path.split("/")) {
      let next = cursor.children.get(segment);
      if (!next) {
        next = {
          name: segment,
          path: cursor.path ? `${cursor.path}/${segment}` : segment,
          children: new Map(),
          hit: null,
        };
        cursor.children.set(segment, next);
      }
      cursor = next;
    }
    cursor.hit = hit;
  }

  const nodes = foldHits(root, layers, isExpanded).children;

  if (unnamed.length > 0) {
    nodes.push({
      type: "prefix",
      id: UNNAMED_PREFIX,
      name: UNNAMED_PREFIX,
      unnamed: true,
      count: unnamed.length,
      children: isExpanded(UNNAMED_PREFIX)
        ? unnamed.map((hit) => objectNode(hitEntry(hit, 0), layers, [], hit.ranges))
        : [],
    });
  }

  if (total > hits.length) {
    nodes.push({ type: "more", id: "more", count: total - hits.length });
  }

  return nodes;
}

/** A hit in the shape a listing gives an object, with `count` objects below it. */
function hitEntry(hit: ObjectFindHit, count: number): ObjectNodeEntry {
  const cut = hit.path.lastIndexOf("/");
  return {
    objectHash: hit.objectHash,
    path: hit.path,
    name: cut < 0 ? hit.path : hit.path.slice(cut + 1),
    declarations: hit.declarations,
    count,
  };
}

/** The rows under one trie node, single-child prefix runs folded, with the hits below it counted. */
function foldHits(
  node: HitNode,
  layers: LayerDeclarations,
  isExpanded: (path: string) => boolean,
): { children: ObjectTreeNode[]; count: number } {
  const prefixes: ObjectPrefixNode[] = [];
  const objects: ObjectRowNode[] = [];
  let count = 0;

  for (let child of node.children.values()) {
    /* The folded row keeps the deepest path of its run. Expansion state addresses the
       node that holds the hits. */
    let name = child.name;
    while (child.hit === null && child.children.size === 1) {
      const only = child.children.values().next().value!;
      if (only.hit !== null) break;
      name = `${name}/${only.name}`;
      child = only;
    }

    const inner = foldHits(child, layers, isExpanded);
    count += inner.count;
    if (child.hit === null) {
      prefixes.push({
        type: "prefix",
        id: child.path,
        name,
        unnamed: false,
        count: inner.count,
        children: isExpanded(child.path) ? inner.children : [],
      });
      continue;
    }
    count += 1;
    objects.push(
      objectNode(
        hitEntry(child.hit, inner.count),
        layers,
        isExpanded(child.path) ? inner.children : [],
        child.hit.ranges,
      ),
    );
  }

  prefixes.sort((a, b) => compareNames(a.name, b.name));
  objects.sort((a, b) => compareNames(a.name, b.name));
  return { children: [...prefixes, ...objects], count };
}

export interface ObjectTreeRow {
  readonly node: ObjectTreeNode;
  readonly depth: number;
}

/** Walk a tree into the rows to render, for the virtualizer. */
export function flattenObjectTree(
  nodes: readonly ObjectTreeNode[],
  isExpanded: (node: ObjectTreeNode) => boolean,
): ObjectTreeRow[] {
  const out: ObjectTreeRow[] = [];
  const walk = (list: readonly ObjectTreeNode[], depth: number): void => {
    for (const node of list) {
      out.push({ node, depth });
      if ((node.type === "prefix" || node.type === "object") && isExpanded(node)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return out;
}

/** The runs of `ranges`, offsets into `path`, that fall in its last segment, re-based on it. */
export function rangesInName(
  path: string,
  ranges: readonly MatchRange[] | undefined,
): readonly MatchRange[] {
  if (!ranges) return [];
  const cut = path.lastIndexOf("/") + 1;
  const out: MatchRange[] = [];
  for (const [start, end] of ranges) {
    const from = Math.max(start, cut) - cut;
    const to = Math.min(end, path.length) - cut;
    if (to > from) out.push([from, to]);
  }
  return out;
}

/** Whether a root listing holds the unnamed group and nothing else. */
export function holdsOnlyUnnamed(listing: ObjectDirListing): boolean {
  return (
    listing.objects.length === 0 &&
    listing.prefixes.length > 0 &&
    listing.prefixes.every((prefix) => prefix.path === UNNAMED_PREFIX)
  );
}

/** Whether `text` is an object hash as the index spells one. */
export function isObjectHash(text: string): boolean {
  return /^0x[0-9a-f]{8}$/i.test(text);
}

/**
 * Every prefix a reveal opens on the way down to `path`, outermost first.
 *
 * A folded row is keyed by the deepest path of its run. Every prefix is named, and the ones
 * no row carries open nothing. A hash sits under the unnamed group.
 */
export function ancestorPrefixes(path: string): string[] {
  if (isObjectHash(path)) return [UNNAMED_PREFIX];
  const segments = path.split("/");
  const out: string[] = [];
  for (let at = 1; at < segments.length; at += 1) {
    out.push(segments.slice(0, at).join("/"));
  }
  return out;
}

/** Whether `path` sits somewhere below the prefix `prefix`, the prefix itself excluded. */
export function isBelowPrefix(path: string, prefix: string): boolean {
  return ancestorPrefixes(path).includes(prefix);
}

/** The ids of every node in `nodes` that has children to open, at any depth. */
export function branchIds(nodes: readonly ObjectTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly ObjectTreeNode[]): void => {
    for (const node of list) {
      if (!expandable(node)) {
        continue;
      }

      out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
