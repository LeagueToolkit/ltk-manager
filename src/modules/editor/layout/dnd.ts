import { type Edge, findLeaf, type LayoutNode, leafHolding } from "./tree";

/** What one droppable id names: a position in a strip, or a region of a leaf. */
export type DropTarget =
  | { kind: "tab"; leafId: string; documentId: string }
  | { kind: "leaf"; leafId: string; region: "center" | Edge };

/** The droppable id for one tab's position in a leaf's strip. */
export function tabDroppableId(leafId: string, documentId: string): string {
  return `tab:${leafId}:${documentId}`;
}

/** The droppable id for the centre or one edge of a leaf's surface. */
export function leafDroppableId(leafId: string, region: "center" | Edge): string {
  return `leaf:${leafId}:${region}`;
}

const regions: readonly string[] = ["center", "top", "right", "bottom", "left"];

function isRegion(value: string): value is "center" | Edge {
  return regions.includes(value);
}

/* Leaf ids never hold a colon and document ids do (`strings:base:en_US`), so
   the split is at the first colon after the prefix and the tail stays whole. */
function splitAfterPrefix(id: string, prefix: string): [string, string] | null {
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const colon = rest.indexOf(":");
  if (colon <= 0 || colon === rest.length - 1) return null;
  return [rest.slice(0, colon), rest.slice(colon + 1)];
}

/** The target a droppable id names, or null for an id this module did not mint. */
export function decodeDroppableId(id: string): DropTarget | null {
  const tab = splitAfterPrefix(id, "tab:");
  if (tab) return { kind: "tab", leafId: tab[0], documentId: tab[1] };

  const leaf = splitAfterPrefix(id, "leaf:");
  if (leaf) {
    const [leafId, region] = leaf;
    if (isRegion(region)) return { kind: "leaf", leafId, region };
  }
  return null;
}

/** The one layout change a completed drag asks for. */
export type DropOutcome =
  | { kind: "reorder"; leafId: string; ids: string[] }
  | {
      kind: "move";
      documentId: string;
      toLeafId: string;
      /** Position in the target strip. Absent means the end. */
      index?: number;
    }
  | { kind: "split"; documentId: string; targetLeafId: string; edge: Edge };

/**
 * Resolve a finished drag to one outcome, or null for a drop that changes nothing.
 *
 * The active id must be a tab droppable whose document the tree still holds,
 * so a stale drag resolves to nothing rather than a wrong move. An edge drop
 * on a leaf holding only the dragged tab is null too, since the leaf would
 * split into itself.
 */
export function resolveDrop(
  tree: LayoutNode,
  activeId: string,
  overId: string,
): DropOutcome | null {
  const active = decodeDroppableId(activeId);
  if (active?.kind !== "tab") return null;

  const source = leafHolding(tree, active.documentId);
  if (!source) return null;

  const over = decodeDroppableId(overId);
  if (!over) return null;

  const target = findLeaf(tree, over.leafId);
  if (!target) return null;

  if (over.kind === "tab") {
    if (target.id !== source.id) {
      const index = target.tabs.indexOf(over.documentId);
      return index < 0
        ? { kind: "move", documentId: active.documentId, toLeafId: target.id }
        : { kind: "move", documentId: active.documentId, toLeafId: target.id, index };
    }

    const from = source.tabs.indexOf(active.documentId);
    const to = source.tabs.indexOf(over.documentId);
    if (to < 0 || to === from) return null;

    const ids = [...source.tabs];
    ids.splice(from, 1);
    ids.splice(to, 0, active.documentId);
    return { kind: "reorder", leafId: source.id, ids };
  }

  if (over.region === "center") {
    if (target.id === source.id) return null;
    return { kind: "move", documentId: active.documentId, toLeafId: target.id };
  }

  if (target.id === source.id && source.tabs.length === 1) return null;
  return {
    kind: "split",
    documentId: active.documentId,
    targetLeafId: target.id,
    edge: over.region,
  };
}
