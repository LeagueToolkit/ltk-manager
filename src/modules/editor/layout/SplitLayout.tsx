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
          {index > 0 && <Seam orientation={orientation} />}
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

/**
 * A 6px transparent grab area matching the gap it replaces, with a centred 2px
 * rail. SidePanel's ResizeHandle draws the same control, so the two read as one.
 */
export function Seam({ orientation }: { orientation: "horizontal" | "vertical" }) {
  return (
    <Separator
      className={twMerge(
        "group/seam relative shrink-0 outline-none",
        orientation === "horizontal" ? "w-1.5" : "h-1.5",
      )}
    >
      <span
        aria-hidden="true"
        className={twMerge(
          "absolute transition-colors group-hover/seam:bg-accent-500/60 group-focus-visible/seam:bg-accent-500",
          orientation === "horizontal"
            ? "inset-y-0 left-1/2 w-0.5 -translate-x-1/2"
            : "inset-x-0 top-1/2 h-0.5 -translate-y-1/2",
        )}
      />
    </Separator>
  );
}
