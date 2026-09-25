import type { DeclaredModule } from "@/lib/tauri";

import { moduleItemId, type OutlineNode } from "./outlineTree";

/** Where a dragged row lands: into a module, or above or below it in the apply order. */
export interface DropTarget {
  /** The item id of the module row the drop marks. */
  moduleId: string;
  layer: string;
  module: DeclaredModule;
  placement: "into" | "above" | "below";
}

/** Whether a row can be picked up: any module, and an entry or a key of an `entries` module. */
export function isDraggable(node: OutlineNode): boolean {
  if (node.type === "module") return true;
  if (node.type === "entry" || node.type === "key") return node.module.selector === "entries";
  return false;
}

/** The module a row sits in, which a drop on the row lands in. */
export function moduleOfRow(node: OutlineNode): DeclaredModule | null {
  switch (node.type) {
    case "module":
    case "entry":
    case "key":
    case "link":
    case "override":
    case "empty":
      return node.module;
    default:
      return null;
  }
}

/**
 * Where `dragged` lands dropped on the row `over`, or null where it cannot.
 *
 * A module lands above a module ahead of it and below one after it. An entry or a key lands in
 * another `entries` module of its own layer. Nothing crosses layers.
 */
export function dropTarget(dragged: OutlineNode, over: OutlineNode): DropTarget | null {
  const module = moduleOfRow(over);
  if (module === null || !isDraggable(dragged) || over.type === "add" || over.type === "layer") {
    return null;
  }
  if (dragged.type === "layer" || dragged.type === "add" || dragged.layer !== over.layer) {
    return null;
  }

  const target = {
    moduleId: moduleItemId(over.layer, module.index),
    layer: over.layer,
    module,
  };
  const from = moduleOfRow(dragged)!;

  if (dragged.type === "module") {
    if (module.index === from.index) return null;
    return { ...target, placement: module.index < from.index ? "above" : "below" };
  }

  if (module.selector !== "entries" || module.index === from.index) return null;
  return { ...target, placement: "into" };
}
