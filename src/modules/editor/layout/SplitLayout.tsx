import { Fragment, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { twMerge } from "@/utils";

import type { LayoutNode, LeafNode } from "./tree";

export interface SplitLayoutProps {
  node: LayoutNode;
  /** What the library reported for one split. Only user-driven changes arrive here. */
  onLayoutChanged: (splitId: string, layout: Record<string, number>) => void;
  /** Draws one editor group, so this module never learns what a document is. */
  renderLeaf: (leaf: LeafNode) => ReactNode;
}

/**
 * The split tree on screen: a `Group` per split, a `Panel` per child, a seam between.
 *
 * The `Group` is keyed by its children's ids because `defaultLayout` is read at
 * mount alone. A split gaining or losing a child remounts its group, which is
 * what hands the library the redistributed shares the tree computed.
 */
export function SplitLayout({ node, onLayoutChanged, renderLeaf }: SplitLayoutProps) {
  if (node.kind === "leaf") return renderLeaf(node);

  const orientation = node.dir === "row" ? "horizontal" : "vertical";

  return (
    <Group
      key={node.children.map((child) => child.id).join("+")}
      id={node.id}
      orientation={orientation}
      defaultLayout={node.layout}
      onLayoutChanged={(layout, meta) => {
        if (meta.isUserInteraction) onLayoutChanged(node.id, layout);
      }}
      className="min-h-0 min-w-0 flex-1"
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && <Seam orientation={orientation} variant="divider" />}
          <Panel id={child.id} minSize={120} className="flex h-full w-full flex-col">
            {child.kind === "leaf" && renderLeaf(child)}
            {child.kind === "split" && (
              <SplitLayout node={child} onLayoutChanged={onLayoutChanged} renderLeaf={renderLeaf} />
            )}
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

export interface SeamProps {
  orientation: "horizontal" | "vertical";
  /**
   * `gap` holds two islands apart and shows its rail while it is hovered.
   * `divider` is the edge between two panes of one island, and always shows.
   */
  variant?: "gap" | "divider";
}

/**
 * The boundary between two panels, and the control that drags it.
 *
 * Both variants are the 6px band with a centred 2px rail that SidePanel's
 * ResizeHandle draws, so every seam reads as one control. A `gap` is
 * transparent, because the islands either side of it already mark their edges.
 * A `divider` parts two panes that share one frame and would otherwise meet
 * with no edge at all, so it fills its band and carries a grip until the rail
 * takes over on hover.
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
        divider && "bg-surface-900",
      )}
    >
      {divider && (
        <span
          aria-hidden="true"
          className={twMerge(
            "flex gap-0.5 transition-opacity group-hover/seam:opacity-0 group-focus-visible/seam:opacity-0",
            horizontal ? "flex-col" : "flex-row",
          )}
        >
          <span className="h-0.5 w-0.5 rounded-full bg-surface-500" />
          <span className="h-0.5 w-0.5 rounded-full bg-surface-500" />
          <span className="h-0.5 w-0.5 rounded-full bg-surface-500" />
        </span>
      )}
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
