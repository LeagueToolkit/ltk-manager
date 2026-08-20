import {
  findLeaf,
  insertTab,
  type LayoutNode,
  leafHolding,
  type LeafNode,
  leaves,
  mergeToSingleLeaf,
  moveTab,
  removeTab,
  replaceTab,
  setActiveTab,
  setSplitLayout,
  singleLeaf,
  splitLeaf,
  type SplitNode,
} from "../tree";

function leaf(id: string, tabs: string[], activeTab: string | null = tabs[0] ?? null): LeafNode {
  return { kind: "leaf", id, tabs, activeTab };
}

function asLeaf(node: LayoutNode): LeafNode {
  if (node.kind !== "leaf") throw new Error(`expected a leaf, got split ${node.id}`);
  return node;
}

function asSplit(node: LayoutNode): SplitNode {
  if (node.kind !== "split") throw new Error(`expected a split, got leaf ${node.id}`);
  return node;
}

const nested: SplitNode = {
  kind: "split",
  id: "split-2",
  dir: "row",
  children: [
    leaf("leaf-1", ["files:base"]),
    {
      kind: "split",
      id: "split-3",
      dir: "col",
      children: [
        leaf("leaf-4", ["strings:base:en_US", "strings:base:pl_PL"]),
        leaf("leaf-5", ["files:skin0"]),
      ],
    },
    leaf("leaf-6", ["files:map11"]),
  ],
};

describe("singleLeaf", () => {
  it("creates the root leaf with the given active tab", () => {
    expect(singleLeaf(["files:base", "strings:base:en_US"], "strings:base:en_US")).toEqual({
      kind: "leaf",
      id: "leaf-1",
      tabs: ["files:base", "strings:base:en_US"],
      activeTab: "strings:base:en_US",
    });
  });

  it("falls back to the first tab for an active id the tabs do not hold", () => {
    expect(singleLeaf(["files:base", "files:skin0"], "strings:stale").activeTab).toBe("files:base");
  });

  it("gives an empty strip a null active tab", () => {
    expect(singleLeaf()).toEqual({ kind: "leaf", id: "leaf-1", tabs: [], activeTab: null });
  });

  it("copies the tabs it was given", () => {
    const tabs = ["files:base"];
    const root = singleLeaf(tabs);
    tabs.push("files:skin0");
    expect(root.tabs).toEqual(["files:base"]);
  });
});

describe("findLeaf", () => {
  it("finds a nested leaf by identity", () => {
    const branch = asSplit(nested.children[1]!);
    expect(findLeaf(nested, "leaf-5")).toBe(branch.children[1]);
  });

  it("returns null for an unknown id", () => {
    expect(findLeaf(nested, "leaf-9")).toBeNull();
    expect(findLeaf(nested, "split-3")).toBeNull();
  });
});

describe("leafHolding", () => {
  it("finds the leaf holding a document", () => {
    expect(leafHolding(nested, "strings:base:pl_PL")?.id).toBe("leaf-4");
  });

  it("returns null for a document no leaf holds", () => {
    expect(leafHolding(nested, "files:missing")).toBeNull();
  });
});

describe("leaves", () => {
  it("walks depth first in reading order", () => {
    expect(leaves(nested).map((node) => node.id)).toEqual(["leaf-1", "leaf-4", "leaf-5", "leaf-6"]);
  });
});

describe("insertTab", () => {
  it("appends and activates when the index is absent", () => {
    const tree = singleLeaf(["files:base"], "files:base");
    const next = asLeaf(insertTab(tree, "leaf-1", "strings:base:en_US"));
    expect(next.tabs).toEqual(["files:base", "strings:base:en_US"]);
    expect(next.activeTab).toBe("strings:base:en_US");
  });

  it("inserts at the given index", () => {
    const tree = singleLeaf(["files:base", "files:skin0"]);
    const next = asLeaf(insertTab(tree, "leaf-1", "strings:base:en_US", 1));
    expect(next.tabs).toEqual(["files:base", "strings:base:en_US", "files:skin0"]);
    expect(next.activeTab).toBe("strings:base:en_US");
  });

  it("only activates an id the leaf already holds, ignoring the index", () => {
    const tree = singleLeaf(["files:base", "files:skin0"], "files:base");
    const next = asLeaf(insertTab(tree, "leaf-1", "files:skin0", 0));
    expect(next.tabs).toEqual(["files:base", "files:skin0"]);
    expect(next.activeTab).toBe("files:skin0");
  });

  it("returns the same tree for the already-active tab", () => {
    const tree = singleLeaf(["files:base"], "files:base");
    expect(insertTab(tree, "leaf-1", "files:base")).toBe(tree);
  });

  it("returns the same tree for an unknown leaf", () => {
    const tree = singleLeaf(["files:base"]);
    expect(insertTab(tree, "leaf-9", "files:skin0")).toBe(tree);
  });
});

describe("replaceTab", () => {
  it("swaps the tab where it sits and activates it", () => {
    const tree = leaf("leaf-1", ["a", "b", "c"], "a");

    const next = asLeaf(replaceTab(tree, "leaf-1", "b", "d"));

    expect(next.tabs).toEqual(["a", "d", "c"]);
    expect(next.activeTab).toBe("d");
  });

  it("keeps the tree when the leaf does not hold the outgoing tab", () => {
    const tree = leaf("leaf-1", ["a"], "a");

    expect(replaceTab(tree, "leaf-1", "b", "c")).toBe(tree);
  });

  /* The incoming tab is already on screen, so a swap would drop one of the two
     and leave the strip holding a document it no longer shows. */
  it("keeps the tree when the leaf already holds the incoming tab", () => {
    const tree = leaf("leaf-1", ["a", "b"], "a");

    expect(replaceTab(tree, "leaf-1", "a", "b")).toBe(tree);
  });

  it("leaves every untouched node's identity alone", () => {
    const next = asSplit(replaceTab(nested, "leaf-4", "strings:base:en_US", "preview:x"));

    expect(next.children[0]).toBe(nested.children[0]);
    expect(next.children[2]).toBe(nested.children[2]);
    expect(asLeaf(asSplit(next.children[1]!).children[1]!)).toBe(
      asSplit(nested.children[1]!).children[1],
    );
  });
});

describe("removeTab", () => {
  const trio: SplitNode = {
    kind: "split",
    id: "split-2",
    dir: "row",
    children: [
      leaf("leaf-1", ["files:base"]),
      leaf("leaf-3", ["strings:base:en_US"]),
      leaf("leaf-4", ["files:skin0"]),
    ],
    layout: { "leaf-1": 0.2, "leaf-3": 0.3, "leaf-4": 0.5 },
  };

  it("hands the active slot to the right neighbour", () => {
    const tree = singleLeaf(
      ["files:base", "strings:base:en_US", "files:skin0"],
      "strings:base:en_US",
    );
    const next = asLeaf(removeTab(tree, "leaf-1", "strings:base:en_US"));
    expect(next.tabs).toEqual(["files:base", "files:skin0"]);
    expect(next.activeTab).toBe("files:skin0");
  });

  it("falls back to the left neighbour at the end of the strip", () => {
    const tree = singleLeaf(["files:base", "files:skin0"], "files:skin0");
    expect(asLeaf(removeTab(tree, "leaf-1", "files:skin0")).activeTab).toBe("files:base");
  });

  it("keeps the active tab when another tab closes", () => {
    const tree = singleLeaf(["files:base", "files:skin0"], "files:base");
    expect(asLeaf(removeTab(tree, "leaf-1", "files:skin0")).activeTab).toBe("files:base");
  });

  it("keeps the root leaf alive after its last tab closes", () => {
    const tree = singleLeaf(["files:base"]);
    expect(removeTab(tree, "leaf-1", "files:base")).toEqual({
      kind: "leaf",
      id: "leaf-1",
      tabs: [],
      activeTab: null,
    });
  });

  it("drops an emptied leaf and gives its share to the previous sibling", () => {
    const next = asSplit(removeTab(trio, "leaf-3", "strings:base:en_US"));
    expect(next.children.map((child) => child.id)).toEqual(["leaf-1", "leaf-4"]);
    expect(next.layout).toEqual({ "leaf-1": 0.5, "leaf-4": 0.5 });
    expect(next.children[0]).toBe(trio.children[0]);
  });

  it("gives a leading leaf's share to the next sibling", () => {
    const next = asSplit(removeTab(trio, "leaf-1", "files:base"));
    expect(next.children.map((child) => child.id)).toEqual(["leaf-3", "leaf-4"]);
    expect(next.layout).toEqual({ "leaf-3": 0.5, "leaf-4": 0.5 });
  });

  it("collapses a two-child split into the surviving leaf", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [leaf("leaf-1", ["files:base"]), leaf("leaf-3", ["files:skin0"])],
    };
    expect(removeTab(tree, "leaf-3", "files:skin0")).toBe(tree.children[0]);
  });

  it("renames the parent share when a split collapses to one child", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      layout: { "split-3": 0.6, "leaf-4": 0.4 },
      children: [
        {
          kind: "split",
          id: "split-3",
          dir: "col",
          children: [leaf("leaf-1", ["files:base"]), leaf("leaf-5", ["strings:base:en_US"])],
        },
        leaf("leaf-4", ["files:skin0"]),
      ],
    };
    const next = asSplit(removeTab(tree, "leaf-5", "strings:base:en_US"));
    expect(next.children.map((child) => child.id)).toEqual(["leaf-1", "leaf-4"]);
    expect(next.layout).toEqual({ "leaf-1": 0.6, "leaf-4": 0.4 });
  });

  it("returns the same tree for a tab the leaf does not hold or an unknown leaf", () => {
    const tree = singleLeaf(["files:base"]);
    expect(removeTab(tree, "leaf-1", "files:missing")).toBe(tree);
    expect(removeTab(tree, "leaf-9", "files:base")).toBe(tree);
  });
});

describe("moveTab", () => {
  const tree: SplitNode = {
    kind: "split",
    id: "split-2",
    dir: "row",
    children: [
      leaf("leaf-1", ["files:base", "strings:base:en_US", "files:skin0"], "strings:base:en_US"),
      leaf("leaf-3", ["files:map11"]),
    ],
  };

  it("moves the active tab and hands the source's focus to the right neighbour", () => {
    const next = asSplit(moveTab(tree, "strings:base:en_US", "leaf-3"));
    expect(asLeaf(next.children[0]!)).toEqual(
      leaf("leaf-1", ["files:base", "files:skin0"], "files:skin0"),
    );
    expect(asLeaf(next.children[1]!)).toEqual(
      leaf("leaf-3", ["files:map11", "strings:base:en_US"], "strings:base:en_US"),
    );
  });

  it("leaves the source's active tab alone when a non-active tab moves", () => {
    const next = asSplit(moveTab(tree, "files:skin0", "leaf-3"));
    expect(asLeaf(next.children[0]!)).toEqual(
      leaf("leaf-1", ["files:base", "strings:base:en_US"], "strings:base:en_US"),
    );
    expect(asLeaf(next.children[1]!)).toEqual(
      leaf("leaf-3", ["files:map11", "files:skin0"], "files:skin0"),
    );
  });

  it("respects the target index", () => {
    const next = asSplit(moveTab(tree, "files:skin0", "leaf-3", 0));
    expect(asLeaf(next.children[1]!).tabs).toEqual(["files:skin0", "files:map11"]);
  });

  it("prunes a source leaf emptied by the move", () => {
    const next = asLeaf(moveTab(tree, "files:map11", "leaf-1"));
    expect(next.id).toBe("leaf-1");
    expect(next.tabs).toEqual(["files:base", "strings:base:en_US", "files:skin0", "files:map11"]);
    expect(next.activeTab).toBe("files:map11");
  });

  it("reorders within one leaf with remove-then-insert index semantics", () => {
    const next = asSplit(moveTab(tree, "files:base", "leaf-1", 2));
    expect(asLeaf(next.children[0]!)).toEqual(
      leaf("leaf-1", ["strings:base:en_US", "files:skin0", "files:base"], "files:base"),
    );
  });

  it("returns the same tree when the tab already sits at the index and is active", () => {
    expect(moveTab(tree, "strings:base:en_US", "leaf-1", 1)).toBe(tree);
  });

  it("returns the same tree for an unknown document or target", () => {
    expect(moveTab(tree, "files:missing", "leaf-3")).toBe(tree);
    expect(moveTab(tree, "files:base", "leaf-9")).toBe(tree);
  });
});

describe("splitLeaf", () => {
  it.each([
    ["left", "row", ["leaf-2", "leaf-1"]],
    ["right", "row", ["leaf-1", "leaf-2"]],
    ["top", "col", ["leaf-2", "leaf-1"]],
    ["bottom", "col", ["leaf-1", "leaf-2"]],
  ] as const)("splitting on the %s edge makes a %s split", (edge, dir, order) => {
    const tree = singleLeaf(["files:base", "strings:base:en_US"], "files:base");
    const { tree: next, leafId } = splitLeaf(tree, "leaf-1", edge, "strings:base:en_US");

    expect(leafId).toBe("leaf-2");
    const root = asSplit(next);
    expect(root.id).toBe("split-3");
    expect(root.dir).toBe(dir);
    expect(root.layout).toBeUndefined();
    expect(root.children.map((child) => child.id)).toEqual([...order]);
    expect(findLeaf(next, "leaf-1")).toEqual(leaf("leaf-1", ["files:base"]));
    expect(findLeaf(next, "leaf-2")).toEqual(leaf("leaf-2", ["strings:base:en_US"]));
  });

  const rowPair: SplitNode = {
    kind: "split",
    id: "split-2",
    dir: "row",
    children: [
      leaf("leaf-1", ["files:base"]),
      leaf("leaf-3", ["strings:base:en_US", "strings:base:pl_PL"], "strings:base:pl_PL"),
    ],
    layout: { "leaf-1": 0.5, "leaf-3": 0.5 },
  };

  it("flattens into a same-direction parent and halves the target's share", () => {
    const { tree: next, leafId } = splitLeaf(rowPair, "leaf-3", "right", "strings:base:pl_PL");

    expect(leafId).toBe("leaf-4");
    const root = asSplit(next);
    expect(root.id).toBe("split-2");
    expect(root.children.map((child) => child.id)).toEqual(["leaf-1", "leaf-3", "leaf-4"]);
    expect(root.layout).toEqual({ "leaf-1": 0.5, "leaf-3": 0.25, "leaf-4": 0.25 });
    expect(findLeaf(next, "leaf-3")).toEqual(leaf("leaf-3", ["strings:base:en_US"]));
    expect(findLeaf(next, "leaf-4")).toEqual(leaf("leaf-4", ["strings:base:pl_PL"]));
  });

  it("places the flattened sibling before the target for a left edge", () => {
    const { tree: next } = splitLeaf(rowPair, "leaf-3", "left", "strings:base:pl_PL");
    expect(asSplit(next).children.map((child) => child.id)).toEqual(["leaf-1", "leaf-4", "leaf-3"]);
  });

  it("wraps a cross-direction target and moves the parent share to the wrapper", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [
        leaf("leaf-1", ["files:base"]),
        leaf("leaf-3", ["strings:base:en_US", "files:skin0"]),
      ],
      layout: { "leaf-1": 0.3, "leaf-3": 0.7 },
    };
    const { tree: next, leafId } = splitLeaf(tree, "leaf-3", "bottom", "files:skin0");

    expect(leafId).toBe("leaf-4");
    const root = asSplit(next);
    expect(root.layout).toEqual({ "leaf-1": 0.3, "split-5": 0.7 });
    const wrapper = asSplit(root.children[1]!);
    expect(wrapper.id).toBe("split-5");
    expect(wrapper.dir).toBe("col");
    expect(wrapper.layout).toBeUndefined();
    expect(wrapper.children.map((child) => child.id)).toEqual(["leaf-3", "leaf-4"]);
  });

  it("prunes a source leaf emptied by the split", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [leaf("leaf-1", ["files:base"]), leaf("leaf-3", ["strings:base:en_US"])],
      layout: { "leaf-1": 0.4, "leaf-3": 0.6 },
    };
    const { tree: next, leafId } = splitLeaf(tree, "leaf-3", "bottom", "files:base");

    expect(leafId).toBe("leaf-4");
    const root = asSplit(next);
    expect(root.id).toBe("split-5");
    expect(root.dir).toBe("col");
    expect(root.children.map((child) => child.id)).toEqual(["leaf-3", "leaf-4"]);
  });

  it("mints ids above every number a restored tree holds", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [leaf("leaf-1", ["files:base", "files:skin0"]), leaf("leaf-7", ["files:map11"])],
    };
    const { tree: next, leafId } = splitLeaf(tree, "leaf-7", "top", "files:base");

    expect(leafId).toBe("leaf-8");
    const wrapper = asSplit(asSplit(next).children[1]!);
    expect(wrapper.id).toBe("split-9");
    expect(wrapper.children.map((child) => child.id)).toEqual(["leaf-8", "leaf-7"]);
  });

  it("never splits a leaf into itself over its only document", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [leaf("leaf-1", ["files:base"]), leaf("leaf-3", ["files:skin0"])],
    };
    const result = splitLeaf(tree, "leaf-3", "right", "files:skin0");
    expect(result.tree).toBe(tree);
    expect(result.leafId).toBe("leaf-3");
  });

  it("returns the same tree for an unknown target or document", () => {
    const tree = singleLeaf(["files:base", "files:skin0"]);
    expect(splitLeaf(tree, "leaf-9", "right", "files:base").tree).toBe(tree);
    expect(splitLeaf(tree, "leaf-1", "right", "files:missing").tree).toBe(tree);
  });
});

describe("setActiveTab", () => {
  const tree = singleLeaf(["files:base", "files:skin0"], "files:base");

  it("activates a tab the leaf holds", () => {
    expect(asLeaf(setActiveTab(tree, "leaf-1", "files:skin0")).activeTab).toBe("files:skin0");
  });

  it("returns the same tree for a tab the leaf does not hold or an unknown leaf", () => {
    expect(setActiveTab(tree, "leaf-1", "files:missing")).toBe(tree);
    expect(setActiveTab(tree, "leaf-9", "files:skin0")).toBe(tree);
  });

  it("returns the same tree for the already-active tab", () => {
    expect(setActiveTab(tree, "leaf-1", "files:base")).toBe(tree);
  });
});

describe("setSplitLayout", () => {
  const tree: SplitNode = {
    kind: "split",
    id: "split-2",
    dir: "row",
    children: [
      leaf("leaf-1", ["files:base"]),
      {
        kind: "split",
        id: "split-3",
        dir: "col",
        children: [leaf("leaf-4", ["strings:base:en_US"]), leaf("leaf-5", ["files:skin0"])],
        layout: { "leaf-4": 0.5, "leaf-5": 0.5 },
      },
    ],
  };

  it("writes a copy of the reported shares onto the split", () => {
    const shares = { "leaf-4": 0.7, "leaf-5": 0.3 };
    const next = asSplit(setSplitLayout(tree, "split-3", shares));
    shares["leaf-4"] = 0;
    expect(asSplit(next.children[1]!).layout).toEqual({ "leaf-4": 0.7, "leaf-5": 0.3 });
    expect(next.children[0]).toBe(tree.children[0]);
  });

  it("returns the same tree for identical shares", () => {
    expect(setSplitLayout(tree, "split-3", { "leaf-5": 0.5, "leaf-4": 0.5 })).toBe(tree);
  });

  it("returns the same tree for an unknown split", () => {
    expect(setSplitLayout(tree, "split-9", { "leaf-4": 1 })).toBe(tree);
  });
});

describe("mergeToSingleLeaf", () => {
  it("gathers every tab in reading order under the focused leaf", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [
        leaf("leaf-1", ["files:base"]),
        {
          kind: "split",
          id: "split-3",
          dir: "col",
          children: [
            leaf("leaf-4", ["strings:base:en_US", "strings:base:pl_PL"], "strings:base:pl_PL"),
            leaf("leaf-5", ["files:skin0"]),
          ],
        },
      ],
    };
    expect(mergeToSingleLeaf(tree, "leaf-4")).toEqual({
      kind: "leaf",
      id: "leaf-4",
      tabs: ["files:base", "strings:base:en_US", "strings:base:pl_PL", "files:skin0"],
      activeTab: "strings:base:pl_PL",
    });
  });

  it("falls back to the first tab when the focused leaf has no active tab", () => {
    const tree: SplitNode = {
      kind: "split",
      id: "split-2",
      dir: "row",
      children: [
        leaf("leaf-1", ["files:base"]),
        { kind: "leaf", id: "leaf-3", tabs: ["files:skin0"], activeTab: null },
      ],
    };
    expect(asLeaf(mergeToSingleLeaf(tree, "leaf-3")).activeTab).toBe("files:base");
  });

  it("returns a tree that is already a leaf unchanged", () => {
    const tree = singleLeaf(["files:base"]);
    expect(mergeToSingleLeaf(tree, "leaf-1")).toBe(tree);
  });
});

describe("structural sharing", () => {
  it("keeps an untouched subtree's identity across an edit elsewhere", () => {
    const next = asSplit(insertTab(nested, "leaf-6", "files:new"));
    expect(next).not.toBe(nested);
    expect(next.children[0]).toBe(nested.children[0]);
    expect(next.children[1]).toBe(nested.children[1]);
  });
});
