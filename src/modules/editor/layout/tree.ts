/** The side of a leaf a tab drops on. `left` and `top` place the new leaf before the target. */
export type Edge = "top" | "right" | "bottom" | "left";

/** One editor group: a tab strip over a stack of documents. */
export interface LeafNode {
  kind: "leaf";
  id: string;
  /** Document ids in strip order. Empty only while this leaf is the whole tree. */
  tabs: string[];
  activeTab: string | null;
}

export interface SplitNode {
  kind: "split";
  id: string;
  dir: "row" | "col";
  children: LayoutNode[];
  /** What the library last reported, keyed by child id. Absent means even shares. */
  layout?: Record<string, number>;
}

export type LayoutNode = SplitNode | LeafNode;

/**
 * The starting tree, and what a reset produces.
 *
 * An `activeTab` the tabs do not hold falls back to the first tab, so a caller
 * migrating older state cannot hand the strip an active id it cannot show.
 */
export function singleLeaf(
  tabs: readonly string[] = [],
  activeTab: string | null = null,
): LeafNode {
  const active = activeTab !== null && tabs.includes(activeTab) ? activeTab : (tabs[0] ?? null);
  return { kind: "leaf", id: "leaf-1", tabs: [...tabs], activeTab: active };
}

/** The leaf with this id, or null. */
export function findLeaf(tree: LayoutNode, leafId: string): LeafNode | null {
  if (tree.kind === "leaf") return tree.id === leafId ? tree : null;
  for (const child of tree.children) {
    const found = findLeaf(child, leafId);
    if (found) return found;
  }
  return null;
}

/** The leaf holding this document, or null. One document lives in exactly one leaf. */
export function leafHolding(tree: LayoutNode, documentId: string): LeafNode | null {
  if (tree.kind === "leaf") return tree.tabs.includes(documentId) ? tree : null;
  for (const child of tree.children) {
    const found = leafHolding(child, documentId);
    if (found) return found;
  }
  return null;
}

/** Every leaf, depth first, which is reading order. */
export function leaves(tree: LayoutNode): LeafNode[] {
  if (tree.kind === "leaf") return [tree];
  return tree.children.flatMap(leaves);
}

/* Ids are `leaf-N` and `split-N` over one shared counter, read back off the
   tree itself so a tree restored from storage never mints an id it holds. */
function maxIdNumber(node: LayoutNode): number {
  const own = Number(/-(\d+)$/.exec(node.id)?.[1] ?? 0);
  if (node.kind === "leaf") return own;
  return Math.max(own, ...node.children.map(maxIdNumber));
}

/**
 * Rewrite one leaf, keeping every untouched node's identity.
 *
 * A change that returns the leaf it was given bubbles the whole tree back
 * unchanged, which is what lets the store's identity comparison keep
 * subscribers asleep.
 */
function updateLeaf(
  node: LayoutNode,
  leafId: string,
  change: (leaf: LeafNode) => LeafNode,
): LayoutNode {
  if (node.kind === "leaf") return node.id === leafId ? change(node) : node;

  let changed = false;
  const children = node.children.map((child) => {
    const next = updateLeaf(child, leafId, change);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

/** Appends when the index is absent, and activates. Inserting an id the leaf holds activates it. */
export function insertTab(
  tree: LayoutNode,
  leafId: string,
  documentId: string,
  index?: number,
): LayoutNode {
  return updateLeaf(tree, leafId, (leaf) => {
    if (leaf.tabs.includes(documentId)) {
      return leaf.activeTab === documentId ? leaf : { ...leaf, activeTab: documentId };
    }
    const tabs = [...leaf.tabs];
    tabs.splice(index ?? tabs.length, 0, documentId);
    return { ...leaf, tabs, activeTab: documentId };
  });
}

/**
 * Drops the tab, then prunes.
 *
 * Closing the active tab hands focus to its right-hand neighbour, falling back
 * to the left one at the end of the strip.
 */
export function removeTab(tree: LayoutNode, leafId: string, documentId: string): LayoutNode {
  const removed = updateLeaf(tree, leafId, (leaf) => {
    const index = leaf.tabs.indexOf(documentId);
    if (index < 0) return leaf;

    const tabs = leaf.tabs.filter((tab) => tab !== documentId);
    const activeTab =
      leaf.activeTab === documentId ? (tabs[index] ?? tabs[index - 1] ?? null) : leaf.activeTab;
    return { ...leaf, tabs, activeTab };
  });
  return removed === tree ? tree : prune(removed);
}

/** Remove then insert, then prune. The moved document activates where it lands. */
export function moveTab(
  tree: LayoutNode,
  documentId: string,
  toLeafId: string,
  index?: number,
): LayoutNode {
  const source = leafHolding(tree, documentId);
  if (!source || !findLeaf(tree, toLeafId)) return tree;

  if (source.id === toLeafId) {
    return updateLeaf(tree, toLeafId, (leaf) => {
      const from = leaf.tabs.indexOf(documentId);
      const to = index ?? leaf.tabs.length - 1;
      if (from === to && leaf.activeTab === documentId) return leaf;

      const tabs = [...leaf.tabs];
      tabs.splice(from, 1);
      tabs.splice(Math.min(to, tabs.length), 0, documentId);
      return { ...leaf, tabs, activeTab: documentId };
    });
  }

  return insertTab(removeTab(tree, source.id, documentId), toLeafId, documentId, index);
}

/**
 * Split a leaf on one edge, moving the document into the fresh leaf beside it.
 *
 * Returns the fresh leaf's id so the caller can focus it, and the target's own
 * id when nothing moved. A leaf holding only this document never splits, since
 * it would split into itself.
 */
export function splitLeaf(
  tree: LayoutNode,
  targetLeafId: string,
  edge: Edge,
  documentId: string,
): { tree: LayoutNode; leafId: string } {
  const source = leafHolding(tree, documentId);
  if (!source || !findLeaf(tree, targetLeafId)) return { tree, leafId: targetLeafId };
  if (source.id === targetLeafId && source.tabs.length === 1) {
    return { tree, leafId: targetLeafId };
  }

  const dir = edge === "left" || edge === "right" ? "row" : "col";
  const before = edge === "left" || edge === "top";
  const next = maxIdNumber(tree) + 1;
  const newLeaf: LeafNode = {
    kind: "leaf",
    id: `leaf-${next}`,
    tabs: [documentId],
    activeTab: documentId,
  };

  const inserted = insertBeside(tree, targetLeafId, newLeaf, dir, before, `split-${next + 1}`);
  return { tree: removeTab(inserted, source.id, documentId), leafId: newLeaf.id };
}

/*
 * Insert a fresh leaf against one side of the target.
 *
 * A target whose parent already runs in the same direction takes the leaf as a
 * sibling, and the target's share halves between the two (D3). Any other
 * target wraps in a fresh split with no layout, so the library gives the pair
 * even shares (D4).
 */
function insertBeside(
  node: LayoutNode,
  targetLeafId: string,
  newLeaf: LeafNode,
  dir: "row" | "col",
  before: boolean,
  wrapSplitId: string,
): LayoutNode {
  if (node.kind === "leaf") {
    if (node.id !== targetLeafId) return node;
    const children = before ? [newLeaf, node] : [node, newLeaf];
    return { kind: "split", id: wrapSplitId, dir, children };
  }

  const index = node.children.findIndex(
    (child) => child.kind === "leaf" && child.id === targetLeafId,
  );
  if (index >= 0 && node.dir === dir) {
    const children = [...node.children];
    children.splice(before ? index : index + 1, 0, newLeaf);

    let layout = node.layout;
    if (layout && targetLeafId in layout) {
      const half = layout[targetLeafId] / 2;
      layout = { ...layout, [targetLeafId]: half, [newLeaf.id]: half };
    }
    return { ...node, children, layout };
  }

  let changed = false;
  let layout = node.layout;
  const children = node.children.map((child) => {
    const next = insertBeside(child, targetLeafId, newLeaf, dir, before, wrapSplitId);
    if (next === child) return child;

    changed = true;
    /* Wrapping a direct child renames it, so its share follows it. */
    if (next.id !== child.id && layout && child.id in layout) {
      layout = renameShare(layout, child.id, next.id);
    }
    return next;
  });
  return changed ? { ...node, children, layout } : node;
}

/** Activates one of the leaf's own tabs. An id the leaf does not hold changes nothing. */
export function setActiveTab(tree: LayoutNode, leafId: string, documentId: string): LayoutNode {
  return updateLeaf(tree, leafId, (leaf) => {
    if (!leaf.tabs.includes(documentId) || leaf.activeTab === documentId) return leaf;
    return { ...leaf, activeTab: documentId };
  });
}

/** Writes what `onLayoutChanged` reported for one split. The numbers stay opaque (D4). */
export function setSplitLayout(
  tree: LayoutNode,
  splitId: string,
  layout: Record<string, number>,
): LayoutNode {
  if (tree.kind === "leaf") return tree;
  if (tree.id === splitId) {
    return sameShares(tree.layout, layout) ? tree : { ...tree, layout: { ...layout } };
  }

  let changed = false;
  const children = tree.children.map((child) => {
    const next = setSplitLayout(child, splitId, layout);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

/**
 * Merge every strip into one leaf, in depth-first reading order (D8).
 *
 * The merged leaf keeps the focused leaf's id and its active tab, so the
 * caller's focus survives the reset.
 */
export function mergeToSingleLeaf(tree: LayoutNode, focusedLeafId: string): LayoutNode {
  if (tree.kind === "leaf") return tree;

  const all = leaves(tree);
  const focused = all.find((leaf) => leaf.id === focusedLeafId) ?? all[0];
  const tabs = all.flatMap((leaf) => leaf.tabs);
  const activeTab =
    focused.activeTab !== null && tabs.includes(focused.activeTab)
      ? focused.activeTab
      : (tabs[0] ?? null);
  return { kind: "leaf", id: focused.id, tabs, activeTab };
}

function sameShares(a: Record<string, number> | undefined, b: Record<string, number>): boolean {
  if (!a) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function renameShare(
  layout: Record<string, number>,
  from: string,
  to: string,
): Record<string, number> {
  const { [from]: share, ...rest } = layout;
  return { ...rest, [to]: share };
}

/*
 * One pass after every removal (section 5 of the plan):
 * an empty leaf goes unless it is the root, its share goes to the sibling it
 * sat against, and a split left with one child becomes that child, its share
 * surviving under the new id.
 */
function prune(node: LayoutNode): LayoutNode {
  if (node.kind === "leaf") return node;

  let changed = false;
  const survivors: { child: LayoutNode; originalIndex: number }[] = [];
  const dropped: { id: string; originalIndex: number }[] = [];

  node.children.forEach((child, originalIndex) => {
    const next = prune(child);
    if (next !== child) changed = true;

    if (next.kind === "leaf" && next.tabs.length === 0) {
      dropped.push({ id: child.id, originalIndex });
      changed = true;
      return;
    }
    survivors.push({ child: next, originalIndex });
  });

  /* Unreachable while removals go one tab at a time, but a caller handing in a
     split of empty leaves still deserves a tree and not a crash. */
  if (survivors.length === 0) {
    return { kind: "leaf", id: node.id, tabs: [], activeTab: null };
  }

  let layout: Record<string, number> | undefined = node.layout;
  if (layout) {
    for (const { child, originalIndex } of survivors) {
      const original = node.children[originalIndex];
      if (child.id !== original.id && original.id in layout) {
        layout = renameShare(layout, original.id, child.id);
      }
    }
    for (const gone of dropped) {
      const previous = [...survivors].reverse().find((s) => s.originalIndex < gone.originalIndex);
      const neighbour = previous ?? survivors.find((s) => s.originalIndex > gone.originalIndex);
      const share: number | undefined = layout[gone.id];
      layout = Object.fromEntries(Object.entries(layout).filter(([key]) => key !== gone.id));
      if (neighbour && share !== undefined) {
        layout = {
          ...layout,
          [neighbour.child.id]: (layout[neighbour.child.id] ?? 0) + share,
        };
      }
    }
  }

  if (survivors.length === 1) return survivors[0].child;
  if (!changed && layout === node.layout) return node;
  return { ...node, children: survivors.map((s) => s.child), layout };
}
