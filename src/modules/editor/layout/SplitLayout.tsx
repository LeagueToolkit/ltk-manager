import { Fragment, type ReactNode, useId, useRef, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";

import { useKeys } from "@/modules/keys";
import { twMerge } from "@/utils";

import { findLeaf, type LayoutNode, type LeafNode, leaves } from "./tree";

export interface SplitLayoutProps {
  node: LayoutNode;
  /** What the library reported for one split. Only user-driven changes arrive here. */
  onLayoutChanged: (splitId: string, layout: Record<string, number>) => void;
  /** Draws one editor group, so this module never learns what a document is. */
  renderLeaf: (leaf: LeafNode) => ReactNode;
  /** A gap between framed panes, or a divider between unframed panes. */
  seamVariant?: SeamProps["variant"];
  /** The one leaf drawn, per "Maximizing a panel" in `docs/ux/PROJECT_EDITOR.md`. */
  maximizedLeafId?: string | null;
  /** The restore Esc runs while a leaf is maximized. */
  onRestore?: () => void;
  /**
   * The size in px a collapsed panel keeps, per "Collapsing a panel" in
   * `docs/ux/PROJECT_EDITOR.md`: its strip's height in a column, and its rail's width in a row.
   * Absent leaves no panel collapsible.
   */
  collapsedSize?: number;
  /** Draws a leaf of a panel collapsed in a row, which is a rail of its tabs. */
  renderCollapsedLeaf?: (leaf: LeafNode) => ReactNode;
}

/**
 * The split tree on screen: a `Group` per split, a `Panel` per child, a seam between.
 *
 * The `Group` is keyed by its children's ids because `defaultLayout` is read at
 * mount alone. A split gaining or losing a child remounts its group, which is
 * what hands the library the redistributed shares the tree computed.
 *
 * A maximized leaf draws alone and the rest of the tree waits behind it. The id
 * is read against the tree rather than written into it, and an id the tree does
 * not hold draws the whole tree.
 *
 * A panel collapses to `collapsedSize` when its seam is dragged past its minimum. In a column
 * it keeps its strip, and in a row `renderCollapsedLeaf` draws a rail over it.
 */
export function SplitLayout({
  node,
  onLayoutChanged,
  renderLeaf,
  seamVariant = "divider",
  maximizedLeafId,
  onRestore,
  collapsedSize,
  renderCollapsedLeaf,
}: SplitLayoutProps) {
  /* react-resizable-panels registers group ids application-wide, while retained
     documents and topology remounts can draw copies of the same saved tree. */
  const instanceId = useId();
  const maximized = maximizedLeafId ? findLeaf(node, maximizedLeafId) : null;
  /* A click's resize is not a user interaction to the library, and the tree has to store it. */
  const expanding = useRef(false);

  useKeys(
    "editor",
    { "editor.restorePanel": () => onRestore?.() },
    { enabled: onRestore !== undefined && Boolean(maximized) },
  );

  if (maximized) return renderLeaf(maximized);

  if (node.kind === "leaf") return renderLeaf(node);

  const orientation = node.dir === "row" ? "horizontal" : "vertical";
  const topology = node.children.map((child) => child.id).join();
  const resizeScope = `${instanceId}-${topology}`;
  const resizeId = (nodeId: string) => `${resizeScope}-${nodeId}`;
  /* A strip is a row, so a panel collapsed in a column keeps its own and needs no rail. */
  const railOf = (child: LayoutNode) => {
    if (node.dir === "col" || !renderCollapsedLeaf) return undefined;

    return leaves(child).map((leaf) => (
      <Fragment key={leaf.id}>{renderCollapsedLeaf(leaf)}</Fragment>
    ));
  };
  const defaultLayout = node.layout
    ? Object.fromEntries(
        Object.entries(node.layout).map(([nodeId, size]) => [resizeId(nodeId), size]),
      )
    : undefined;

  return (
    <Group
      key={topology}
      id={resizeId(node.id)}
      orientation={orientation}
      defaultLayout={defaultLayout}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction && !expanding.current) return;
        expanding.current = false;

        const treeLayout = Object.fromEntries(
          node.children.flatMap((child) => {
            const size = layout[resizeId(child.id)];
            return size === undefined ? [] : [[child.id, size]];
          }),
        );

        onLayoutChanged(node.id, treeLayout);
      }}
      className="min-h-0 min-w-0 flex-1"
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && <Seam orientation={orientation} variant={seamVariant} />}
          <SplitPanel
            id={resizeId(child.id)}
            collapsible={collapsedSize !== undefined}
            collapsedSize={collapsedSize}
            expandedSize={`${100 / node.children.length}%`}
            onExpand={() => {
              expanding.current = true;
            }}
            rail={railOf(child)}
          >
            {child.kind === "leaf" && renderLeaf(child)}
            {child.kind === "split" && (
              <SplitLayout
                node={child}
                onLayoutChanged={onLayoutChanged}
                renderLeaf={renderLeaf}
                seamVariant={seamVariant}
                collapsedSize={collapsedSize}
                renderCollapsedLeaf={renderCollapsedLeaf}
              />
            )}
          </SplitPanel>
        </Fragment>
      ))}
    </Group>
  );
}

interface SplitPanelProps {
  id: string;
  collapsible: boolean;
  collapsedSize?: number;
  /** The share a click gives a collapsed panel. */
  expandedSize: string;
  /** Runs before a click expands the panel. */
  onExpand: () => void;
  /** Drawn over the panel's content while the panel is collapsed. */
  rail?: ReactNode;
  children: ReactNode;
}

/** One child of a split. A collapsed one expands on a click in the strip or the rail it kept. */
function SplitPanel({
  id,
  collapsible,
  collapsedSize,
  expandedSize,
  onExpand,
  rail,
  children,
}: SplitPanelProps) {
  const panel = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const railed = collapsed && rail !== undefined;

  return (
    <Panel
      id={id}
      panelRef={panel}
      minSize={120}
      collapsible={collapsible}
      collapsedSize={collapsedSize}
      onResize={() => setCollapsed(panel.current?.isCollapsed() ?? false)}
      onClick={() => {
        if (!panel.current?.isCollapsed()) return;

        onExpand();
        /* `expand` restores only a size an imperative `collapse` left, and a drag leaves none. */
        panel.current.resize(expandedSize);
      }}
      className="relative flex size-full flex-col"
      /* A collapsed panel is smaller than its content, which the library's `auto` would scroll. */
      style={{ overflow: "hidden" }}
    >
      {/* Hidden rather than unmounted, so a document under the rail keeps its state. */}
      <div className={twMerge("flex min-h-0 min-w-0 flex-1 flex-col", railed && "invisible")}>
        {children}
      </div>
      {railed && <div className="absolute inset-0 flex flex-col gap-1.5">{rail}</div>}
    </Panel>
  );
}

export interface SeamProps {
  orientation: "horizontal" | "vertical";
  /**
   * `gap` holds two islands apart over the ground between them.
   * `divider` is the edge between two panes of one island, and fills its band.
   */
  variant?: "gap" | "divider";
}

/**
 * The boundary between two panels, and the control that drags it.
 *
 * Both variants are the 6px band with a centred 2px rail that SidePanel's
 * ResizeHandle draws, so every seam reads as one control, and both carry a grip
 * until the rail takes over on hover. A `gap` is transparent, because the
 * islands either side of it already mark their edges. A `divider` parts two
 * panes that share one frame and would otherwise meet with no edge at all, so
 * it fills its band.
 */
export function Seam({ orientation, variant = "gap" }: SeamProps) {
  const horizontal = orientation === "horizontal";
  const divider = variant === "divider";

  return (
    <Separator
      className={twMerge(
        "group/seam relative flex shrink-0 items-center justify-center outline-none",
        horizontal ? "w-1.5" : "h-1.5",
        /* A rung over the panes it parts, not under them: DS-GROUND. */
        divider && "border-surface-800 bg-surface-900",
        divider && (horizontal ? "border-x" : "border-y"),
      )}
    >
      <span
        aria-hidden="true"
        className={twMerge(
          "flex gap-0.5 transition-opacity group-hover/seam:opacity-0 group-focus-visible/seam:opacity-0",
          horizontal ? "flex-col" : "flex-row",
        )}
      >
        <span className="size-0.5 rounded-full bg-surface-500" />
        <span className="size-0.5 rounded-full bg-surface-500" />
        <span className="size-0.5 rounded-full bg-surface-500" />
      </span>
      <span
        aria-hidden="true"
        className={twMerge(
          "absolute transition-colors group-hover/seam:bg-accent-500/60 group-focus-visible/seam:bg-accent-500",
          horizontal
            ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
            : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2",
        )}
      />
    </Separator>
  );
}
