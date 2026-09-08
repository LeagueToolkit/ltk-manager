import { describe, expect, it } from "vitest";

import { leaves } from "@/modules/editor";

import {
  defaultShellLayout,
  firstShellLeafId,
  openShellPanes,
  sanitizeShellLayout,
} from "../shellPanes";

describe("defaultShellLayout", () => {
  it("opens the three panes that draw something, one to a panel", () => {
    const tree = defaultShellLayout();

    expect([...openShellPanes(tree)]).toEqual(["emitters", "curve", "inspector"]);
    expect(leaves(tree).map((leaf) => leaf.tabs)).toEqual([["emitters"], ["curve"], ["inspector"]]);
  });

  it("starts the reader in the panel holding the emitters", () => {
    expect(firstShellLeafId(defaultShellLayout())).toBe("leaf-3");
  });
});

describe("sanitizeShellLayout", () => {
  it("falls back to one empty panel for a value that is no tree", () => {
    expect(sanitizeShellLayout(null)).toEqual({
      kind: "leaf",
      id: "leaf-1",
      tabs: [],
      activeTab: null,
    });
  });

  it("keeps a tree this build wrote", () => {
    expect(sanitizeShellLayout(defaultShellLayout())).toEqual(defaultShellLayout());
  });

  it("drops a pane it does not know", () => {
    const tree = sanitizeShellLayout({
      kind: "leaf",
      id: "leaf-1",
      tabs: ["curve", "timeline"],
      activeTab: "timeline",
    });

    expect(tree).toEqual({ kind: "leaf", id: "leaf-1", tabs: ["curve"], activeTab: "curve" });
  });

  it("keeps the first of two panels claiming one pane", () => {
    const tree = sanitizeShellLayout({
      kind: "split",
      id: "split-1",
      dir: "row",
      children: [
        { kind: "leaf", id: "leaf-2", tabs: ["curve"], activeTab: "curve" },
        { kind: "leaf", id: "leaf-3", tabs: ["curve", "preview"], activeTab: "curve" },
      ],
    });

    expect(leaves(tree).map((leaf) => leaf.tabs)).toEqual([["curve"], ["preview"]]);
  });

  it("drops a panel left holding nothing, and the split with it", () => {
    const tree = sanitizeShellLayout({
      kind: "split",
      id: "split-1",
      dir: "col",
      children: [
        { kind: "leaf", id: "leaf-2", tabs: [], activeTab: null },
        { kind: "leaf", id: "leaf-3", tabs: ["preview"], activeTab: "preview" },
      ],
    });

    expect(tree).toEqual({ kind: "leaf", id: "leaf-3", tabs: ["preview"], activeTab: "preview" });
  });

  it("drops a share that is not a positive number", () => {
    const tree = sanitizeShellLayout({
      kind: "split",
      id: "split-1",
      dir: "row",
      layout: { "leaf-2": 0, "leaf-3": 3 },
      children: [
        { kind: "leaf", id: "leaf-2", tabs: ["curve"], activeTab: "curve" },
        { kind: "leaf", id: "leaf-3", tabs: ["preview"], activeTab: "preview" },
      ],
    });

    expect(tree.kind === "split" && tree.layout).toEqual({ "leaf-3": 3 });
  });
});
