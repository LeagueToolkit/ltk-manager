import { m } from "@/i18n";
/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import { type LayoutNode, leaves, singleLeaf } from "@/modules/editor/layout";

/** One pane of the shell, which is what a leaf of the shell's tree holds. */
export type ShellPaneId = "emitters" | "curve" | "inspector" | "preview";

export const SHELL_PANE_IDS: readonly ShellPaneId[] = ["emitters", "curve", "inspector", "preview"];

/** What a pane's tab says, and what the Panes menu lists it as. */
export const SHELL_PANE_TITLE: Record<ShellPaneId, () => string> = {
  emitters: m.workshop_bin_pane_emitters_label,
  curve: m.workshop_bin_pane_curve_label,
  inspector: m.workshop_bin_pane_inspector_label,
  preview: m.workshop_bin_pane_preview_label,
};

export function isShellPaneId(value: unknown): value is ShellPaneId {
  return typeof value === "string" && (SHELL_PANE_IDS as readonly string[]).includes(value);
}

/**
 * The panes as ADR-0031 arranged them, which is what a reset produces.
 *
 * The shares are flex-grow ratios rather than sizes, so the strip keeps twice the
 * curve's height at any window width. The preview is left out until a renderer fills it,
 * because the largest thing on screen would otherwise be the one drawing nothing.
 */
export function defaultShellLayout(): LayoutNode {
  return {
    kind: "split",
    id: "split-1",
    dir: "row",
    layout: { "split-2": 2, "leaf-5": 3 },
    children: [
      {
        kind: "split",
        id: "split-2",
        dir: "col",
        layout: { "leaf-3": 2, "leaf-4": 1 },
        children: [
          { kind: "leaf", id: "leaf-3", tabs: ["emitters"], activeTab: "emitters" },
          { kind: "leaf", id: "leaf-4", tabs: ["curve"], activeTab: "curve" },
        ],
      },
      { kind: "leaf", id: "leaf-5", tabs: ["inspector"], activeTab: "inspector" },
    ],
  };
}

/** The leaf a reopened pane lands in when the one the reader focused is gone. */
export function firstShellLeafId(tree: LayoutNode): string {
  return leaves(tree)[0].id;
}

/** Every pane the tree holds, which is what the Panes menu ticks. */
export function openShellPanes(tree: LayoutNode): ReadonlySet<ShellPaneId> {
  return new Set(leaves(tree).flatMap((leaf) => leaf.tabs.filter(isShellPaneId)));
}

/**
 * Shape an untrusted tree into one the shell can draw.
 *
 * A pane this build does not know drops rather than crashing the first render,
 * and a value that is no tree at all falls back to a single empty leaf, which
 * draws the Panes menu and nothing else.
 */
export function sanitizeShellLayout(value: unknown): LayoutNode {
  return readNode(value, new Set()) ?? singleLeaf();
}

/* `held` carries the panes the leaves to the left already took, so a file
   naming one pane twice keeps the first and the tree op that moves it still has
   exactly one leaf to remove it from. */
function readNode(value: unknown, held: Set<ShellPaneId>): LayoutNode | null {
  if (typeof value !== "object" || value === null) return null;
  const node = value as Partial<LayoutNode> & { children?: unknown; layout?: unknown };
  if (typeof node.id !== "string" || node.id.includes(":")) return null;

  if (node.kind === "leaf") {
    const tabs = (Array.isArray(node.tabs) ? node.tabs : []).filter(
      (tab): tab is ShellPaneId => isShellPaneId(tab) && !held.has(tab),
    );
    for (const tab of tabs) held.add(tab);

    const activeTab =
      isShellPaneId(node.activeTab) && tabs.includes(node.activeTab)
        ? node.activeTab
        : (tabs[0] ?? null);
    return { kind: "leaf", id: node.id, tabs, activeTab };
  }

  if (node.kind !== "split") return null;
  if (node.dir !== "row" && node.dir !== "col") return null;
  if (!Array.isArray(node.children)) return null;

  /* An empty leaf under a split is a hole the reader cannot fill, since a pane
     only reopens into the focused leaf. It drops, and its parent with it once
     nothing is left. */
  const children = node.children
    .map((child) => readNode(child, held))
    .filter((child): child is LayoutNode => child !== null)
    .filter((child) => child.kind === "split" || child.tabs.length > 0);
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  return { kind: "split", id: node.id, dir: node.dir, children, layout: readShares(node.layout) };
}

function readShares(value: unknown): Record<string, number> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const shares: Record<string, number> = {};
  for (const [id, share] of Object.entries(value)) {
    if (typeof share === "number" && Number.isFinite(share) && share > 0) shares[id] = share;
  }
  return Object.keys(shares).length === 0 ? undefined : shares;
}
