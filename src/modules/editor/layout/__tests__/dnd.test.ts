import { decodeDroppableId, leafDroppableId, resolveDrop, tabDroppableId } from "../dnd";
import { type Edge, type LayoutNode } from "../tree";

const edges: readonly Edge[] = ["top", "right", "bottom", "left"];

/* leaf-1 holds three documents and leaf-2 only one, so leaf-2 is the strip
   the self-split guard fires on. */
const tree: LayoutNode = {
  kind: "split",
  id: "split-3",
  dir: "row",
  children: [
    {
      kind: "leaf",
      id: "leaf-1",
      tabs: ["files:base", "strings:base:en_US", "info:meta"],
      activeTab: "files:base",
    },
    {
      kind: "leaf",
      id: "leaf-2",
      tabs: ["strings:base:de_DE"],
      activeTab: "strings:base:de_DE",
    },
  ],
};

describe("tabDroppableId", () => {
  it("round trips a document id with one colon", () => {
    const id = tabDroppableId("leaf-1", "files:base");
    expect(id).toBe("tab:leaf-1:files:base");
    expect(decodeDroppableId(id)).toEqual({
      kind: "tab",
      leafId: "leaf-1",
      documentId: "files:base",
    });
  });

  it("round trips a document id with multiple colons", () => {
    const id = tabDroppableId("leaf-12", "strings:base:en_US");
    expect(decodeDroppableId(id)).toEqual({
      kind: "tab",
      leafId: "leaf-12",
      documentId: "strings:base:en_US",
    });
  });
});

describe("leafDroppableId", () => {
  it("round trips the centre and every edge", () => {
    for (const region of ["center", ...edges] as const) {
      expect(decodeDroppableId(leafDroppableId("leaf-2", region))).toEqual({
        kind: "leaf",
        leafId: "leaf-2",
        region,
      });
    }
  });
});

describe("decodeDroppableId", () => {
  it("splits a tab id at the first colon after the leaf id", () => {
    expect(decodeDroppableId("tab:leaf-1:strings:base:en_US")).toEqual({
      kind: "tab",
      leafId: "leaf-1",
      documentId: "strings:base:en_US",
    });
  });

  it("rejects unknown prefixes", () => {
    expect(decodeDroppableId("mod:leaf-1:files:base")).toBeNull();
    expect(decodeDroppableId("files:base")).toBeNull();
  });

  it("rejects the empty string", () => {
    expect(decodeDroppableId("")).toBeNull();
  });

  it("rejects a tab id with missing or empty segments", () => {
    expect(decodeDroppableId("tab:")).toBeNull();
    expect(decodeDroppableId("tab:leaf-1")).toBeNull();
    expect(decodeDroppableId("tab:leaf-1:")).toBeNull();
    expect(decodeDroppableId("tab::files:base")).toBeNull();
  });

  it("rejects a leaf id with missing or empty segments", () => {
    expect(decodeDroppableId("leaf:")).toBeNull();
    expect(decodeDroppableId("leaf:leaf-1")).toBeNull();
    expect(decodeDroppableId("leaf:leaf-1:")).toBeNull();
    expect(decodeDroppableId("leaf::center")).toBeNull();
  });

  it("rejects anything that is not exactly a known region", () => {
    expect(decodeDroppableId("leaf:leaf-1:middle")).toBeNull();
    expect(decodeDroppableId("leaf:leaf-1:Center")).toBeNull();
    expect(decodeDroppableId("leaf:leaf-1:center:extra")).toBeNull();
  });
});

describe("resolveDrop", () => {
  describe("over a tab in the same leaf", () => {
    it("reorders forward, inserting at the over tab's index", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        tabDroppableId("leaf-1", "info:meta"),
      );
      expect(outcome).toEqual({
        kind: "reorder",
        leafId: "leaf-1",
        ids: ["strings:base:en_US", "info:meta", "files:base"],
      });
    });

    it("reorders backward", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "info:meta"),
        tabDroppableId("leaf-1", "files:base"),
      );
      expect(outcome).toEqual({
        kind: "reorder",
        leafId: "leaf-1",
        ids: ["info:meta", "files:base", "strings:base:en_US"],
      });
    });

    it("returns null for a tab dropped on itself", () => {
      const id = tabDroppableId("leaf-1", "strings:base:en_US");
      expect(resolveDrop(tree, id, id)).toBeNull();
    });

    it("returns null when the over tab left the leaf", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        tabDroppableId("leaf-1", "gone:doc"),
      );
      expect(outcome).toBeNull();
    });
  });

  describe("over a tab in another leaf", () => {
    it("moves at the over tab's index", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        tabDroppableId("leaf-2", "strings:base:de_DE"),
      );
      expect(outcome).toStrictEqual({
        kind: "move",
        documentId: "files:base",
        toLeafId: "leaf-2",
        index: 0,
      });
    });

    it("moves without an index when the target no longer holds the over tab", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        tabDroppableId("leaf-2", "gone:doc"),
      );
      expect(outcome).toStrictEqual({
        kind: "move",
        documentId: "files:base",
        toLeafId: "leaf-2",
      });
    });

    it("returns null when the tab's leaf is not in the tree", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        tabDroppableId("leaf-9", "strings:base:de_DE"),
      );
      expect(outcome).toBeNull();
    });
  });

  describe("over a leaf's centre", () => {
    it("moves to the end of another leaf, without an index", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        leafDroppableId("leaf-2", "center"),
      );
      expect(outcome).toStrictEqual({
        kind: "move",
        documentId: "files:base",
        toLeafId: "leaf-2",
      });
    });

    it("returns null for the leaf already holding the tab", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        leafDroppableId("leaf-1", "center"),
      );
      expect(outcome).toBeNull();
    });

    it("returns null for a leaf not in the tree", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        leafDroppableId("leaf-9", "center"),
      );
      expect(outcome).toBeNull();
    });
  });

  describe("over a leaf's edge", () => {
    it("splits another leaf on every edge", () => {
      for (const edge of edges) {
        const outcome = resolveDrop(
          tree,
          tabDroppableId("leaf-1", "files:base"),
          leafDroppableId("leaf-2", edge),
        );
        expect(outcome).toEqual({
          kind: "split",
          documentId: "files:base",
          targetLeafId: "leaf-2",
          edge,
        });
      }
    });

    it("splits the tab's own leaf while it holds other tabs", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        leafDroppableId("leaf-1", "right"),
      );
      expect(outcome).toEqual({
        kind: "split",
        documentId: "files:base",
        targetLeafId: "leaf-1",
        edge: "right",
      });
    });

    it("returns null on every own edge of a leaf holding only the dragged tab", () => {
      for (const edge of edges) {
        const outcome = resolveDrop(
          tree,
          tabDroppableId("leaf-2", "strings:base:de_DE"),
          leafDroppableId("leaf-2", edge),
        );
        expect(outcome).toBeNull();
      }
    });

    it("still splits another leaf when dragging a leaf's only tab", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-2", "strings:base:de_DE"),
        leafDroppableId("leaf-1", "left"),
      );
      expect(outcome).toEqual({
        kind: "split",
        documentId: "strings:base:de_DE",
        targetLeafId: "leaf-1",
        edge: "left",
      });
    });

    it("returns null for a leaf not in the tree", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "files:base"),
        leafDroppableId("leaf-9", "bottom"),
      );
      expect(outcome).toBeNull();
    });
  });

  describe("stale or malformed drags", () => {
    it("returns null when the tree no longer holds the dragged document", () => {
      const outcome = resolveDrop(
        tree,
        tabDroppableId("leaf-1", "gone:doc"),
        leafDroppableId("leaf-2", "center"),
      );
      expect(outcome).toBeNull();
    });

    it("returns null for an active id that is not a tab droppable", () => {
      const over = tabDroppableId("leaf-1", "files:base");
      expect(resolveDrop(tree, leafDroppableId("leaf-1", "center"), over)).toBeNull();
      expect(resolveDrop(tree, "garbage", over)).toBeNull();
      expect(resolveDrop(tree, "", over)).toBeNull();
    });

    it("returns null for an undecodable over id", () => {
      const active = tabDroppableId("leaf-1", "files:base");
      expect(resolveDrop(tree, active, "garbage")).toBeNull();
      expect(resolveDrop(tree, active, "leaf:leaf-2:middle")).toBeNull();
      expect(resolveDrop(tree, active, "")).toBeNull();
    });
  });
});
