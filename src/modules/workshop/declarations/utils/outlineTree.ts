import { m } from "@/i18n";
import type {
  DeclarationsLayer,
  DeclaredEntry,
  DeclaredKey,
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

/** One item of a declarations outline: a layer, a module, an entry or a key. */
export type OutlineNode = LayerNode | ModuleNode | EntryNode | KeyNode;

/** One row of a flattened outline, and how deep it sits. */
export interface OutlineRow {
  node: OutlineNode;
  depth: number;
}

/** What a flattened outline draws. */
export interface OutlineShape {
  /** Draw each layer as a row above its modules. Off where one layer fills the view. */
  layers: boolean;
  /** Draw each entry's keys under it. */
  keys: boolean;
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

/** A module's own name, or its place in the manifest where it spells none. */
export function moduleTitle(module: DeclaredModule): string {
  return module.name ?? m.workshop_declarations_module_title({ number: module.index + 1 });
}

/** How many keys a module declares, over every entry. */
export function moduleKeyCount(module: DeclaredModule): number {
  return module.entries.reduce((total, entry) => total + entry.keys.length, 0);
}

/** The first line of a value, which a one-line row has room for. */
export function valuePreview(value: string): string {
  const cut = value.indexOf("\n");
  return cut < 0 ? value : `${value.slice(0, cut)} …`;
}

/** Where in the manifest's text an item is, or null for one outside it. */
export function itemSpan(node: OutlineNode): LineSpan | null {
  if (node.type === "layer") return node.layer.error?.span ?? null;
  if (node.type === "module") return node.module.span;
  if (node.type === "entry") return node.entry.span;
  return node.key.span;
}

/** Whether a node folds: anything above a key, and an entry only where keys are drawn. */
export function isBranch(node: OutlineNode, shape: OutlineShape): boolean {
  if (node.type === "key") return false;
  if (node.type === "entry") return shape.keys && node.entry.keys.length > 0;
  return true;
}

/**
 * The outline of `layers` as rows, a shut branch's children left out.
 *
 * A layer with no manifest draws no row, since it declares nothing.
 */
export function flattenOutline(
  layers: readonly DeclarationsLayer[],
  isShut: (id: string) => boolean,
  shape: OutlineShape,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const base = shape.layers ? 1 : 0;

  for (const layer of layers) {
    if (layer.file === null) continue;

    const layerId = layerItemId(layer.layer);
    if (shape.layers) {
      rows.push({ node: { type: "layer", id: layerId, layer }, depth: 0 });
      if (isShut(layerId)) continue;
    }

    for (const module of layer.modules) {
      pushModule(rows, layer.layer, module, isShut, shape, base);
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
  });
}

/** The ids of every branch above `id`, which a reveal opens. */
export function ancestorIds(id: string): string[] {
  const [type, layer, ...rest] = id.split(":");
  if (layer === undefined || type === "layer") return [];

  const ancestors = [layerItemId(layer)];
  const [module, position] = rest;
  if (type === "module" || module === undefined) return ancestors;

  ancestors.push(moduleItemId(layer, Number(module)));
  if (type === "entry" || position === undefined) return ancestors;

  ancestors.push(entryItemId(layer, Number(module), Number(position)));
  return ancestors;
}
