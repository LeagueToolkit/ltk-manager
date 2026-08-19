import { Fragment, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { twMerge } from "tailwind-merge";

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
 * A `gap` is a 6px transparent grab area matching the space it replaces, with a
 * centred 2px rail. SidePanel's ResizeHandle draws the same control, so the two
 * read as one. A `divider` draws the panel edge itself, which is why it is a
 * pixel wide and never hides: the library grows any separator under 10px into a
 * hit target of that size, so it still grabs like the wider one.
 */
export function Seam({ orientation, variant = "gap" }: SeamProps) {
  const horizontal = orientation === "horizontal";

  if (variant === "divider") {
    return (
      <Separator
        className={twMerge(
          "shrink-0 bg-surface-700 transition-colors outline-none",
          "hover:bg-accent-500/60 focus-visible:bg-accent-500",
          horizontal ? "w-px" : "h-px",
        )}
      />
    );
  }

  return (
    <Separator
      className={twMerge(
        "group/seam relative shrink-0 outline-none",
        horizontal ? "w-1.5" : "h-1.5",
      )}
    >
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
