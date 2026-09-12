// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SplitLayout } from "../SplitLayout";
import type { LayoutNode, LeafNode } from "../tree";

const TREE: LayoutNode = {
  kind: "split",
  id: "split-1",
  dir: "row",
  children: [
    { kind: "leaf", id: "leaf-1", tabs: ["details"], activeTab: "details" },
    { kind: "leaf", id: "leaf-2", tabs: ["files:base"], activeTab: "files:base" },
  ],
};

/* The library labels its own `Panel` with the leaf's id, which a testid of the
   same name matches as well as the body drawn inside it. */
function renderLeaf(leaf: LeafNode) {
  return <div key={leaf.id} data-testid={`body-${leaf.id}`} />;
}

function draw(maximizedLeafId?: string | null, onRestore?: () => void) {
  render(
    <SplitLayout
      node={TREE}
      onLayoutChanged={() => {}}
      renderLeaf={renderLeaf}
      maximizedLeafId={maximizedLeafId}
      onRestore={onRestore}
    />,
  );
}

describe("SplitLayout", () => {
  it("draws both leaves of a split", () => {
    draw(null);

    expect(screen.getByTestId("body-leaf-1")).toBeInTheDocument();
    expect(screen.getByTestId("body-leaf-2")).toBeInTheDocument();
  });

  it("draws a maximized leaf alone", () => {
    draw("leaf-2");

    expect(screen.getByTestId("body-leaf-2")).toBeInTheDocument();
    expect(screen.queryByTestId("body-leaf-1")).not.toBeInTheDocument();
  });

  it("draws the tree for an id it does not hold", () => {
    draw("leaf-99");

    expect(screen.getByTestId("body-leaf-1")).toBeInTheDocument();
    expect(screen.getByTestId("body-leaf-2")).toBeInTheDocument();
  });

  it("gives the tree back on Escape while a leaf is maximized", async () => {
    const restore = vi.fn();
    draw("leaf-2", restore);

    await userEvent.keyboard("{Escape}");

    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape alone while the tree draws whole", async () => {
    const restore = vi.fn();
    draw(null, restore);

    await userEvent.keyboard("{Escape}");

    expect(restore).not.toHaveBeenCalled();
  });
});
