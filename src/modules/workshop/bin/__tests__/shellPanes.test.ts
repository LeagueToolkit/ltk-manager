import { describe, expect, it } from "vitest";

import { leaves } from "@/modules/editor";

import {
  defaultShellArrangements,
  defaultShellLayout,
  firstShellLeafId,
  openShellPanes,
  sanitizeShellLayout,
  shellPanesOf,
} from "../shellPanes";

describe("defaultShellLayout", () => {
  it("opens the preview and the inspector over the timeline and the curve, one to a panel", () => {
    const tree = defaultShellLayout("vfx");

    expect([...openShellPanes(tree)]).toEqual(["preview", "inspector", "timeline", "curve"]);
    expect(leaves(tree).map((leaf) => leaf.tabs)).toEqual([
      ["preview"],
      ["inspector"],
      ["timeline"],
      ["curve"],
    ]);
  });

  it("leaves the emitters out of the particle system's arrangement, and in its pane set", () => {
    expect(openShellPanes(defaultShellLayout("vfx")).has("emitters")).toBe(false);
    expect(shellPanesOf("vfx")).toContain("emitters");
  });

  it("gives the preview the widest share of the top row", () => {
    const tree = defaultShellLayout("vfx");
    const top = tree.kind === "split" ? tree.children[0] : tree;

    expect(top.kind === "split" && top.layout).toEqual({ "leaf-3": 3, "leaf-4": 2 });
  });

  it("starts the particle system's reader in the panel holding the preview", () => {
    expect(firstShellLeafId(defaultShellLayout("vfx"))).toBe("leaf-3");
  });

  it("puts the skin's preview first, wider than the inspector beside it", () => {
    const tree = defaultShellLayout("skin");

    expect(leaves(tree).map((leaf) => leaf.tabs)).toEqual([["preview"], ["inspector"]]);
    expect(tree.kind === "split" && tree.layout).toEqual({ "leaf-2": 3, "leaf-3": 2 });
    expect(firstShellLeafId(tree)).toBe("leaf-2");
  });
});

describe("defaultShellArrangements", () => {
  it("arranges every shell as it ships, focused on its first panel", () => {
    const shells = defaultShellArrangements();

    expect(shells.vfx).toEqual({ layout: defaultShellLayout("vfx"), leafId: "leaf-3" });
    expect(shells.skin).toEqual({ layout: defaultShellLayout("skin"), leafId: "leaf-2" });
  });
});

describe("sanitizeShellLayout", () => {
  it("falls back to one empty panel for a value that is no tree", () => {
    expect(sanitizeShellLayout("vfx", null)).toEqual({
      kind: "leaf",
      id: "leaf-1",
      tabs: [],
      activeTab: null,
    });
  });

  it("keeps a tree this build wrote", () => {
    expect(sanitizeShellLayout("vfx", defaultShellLayout("vfx"))).toEqual(
      defaultShellLayout("vfx"),
    );
    expect(sanitizeShellLayout("skin", defaultShellLayout("skin"))).toEqual(
      defaultShellLayout("skin"),
    );
  });

  it("drops a pane the shell does not hold", () => {
    const tree = sanitizeShellLayout("skin", {
      kind: "leaf",
      id: "leaf-1",
      tabs: ["preview", "emitters"],
      activeTab: "emitters",
    });

    expect(tree).toEqual({ kind: "leaf", id: "leaf-1", tabs: ["preview"], activeTab: "preview" });
  });

  it("drops a pane it does not know", () => {
    const tree = sanitizeShellLayout("vfx", {
      kind: "leaf",
      id: "leaf-1",
      tabs: ["curve", "lanes"],
      activeTab: "lanes",
    });

    expect(tree).toEqual({ kind: "leaf", id: "leaf-1", tabs: ["curve"], activeTab: "curve" });
  });

  it("opens a tree saved before the timeline existed without the pane", () => {
    const saved = {
      kind: "split",
      id: "split-1",
      dir: "row",
      children: [
        { kind: "leaf", id: "leaf-3", tabs: ["emitters"], activeTab: "emitters" },
        { kind: "leaf", id: "leaf-7", tabs: ["preview", "inspector"], activeTab: "preview" },
      ],
    };

    const tree = sanitizeShellLayout("vfx", saved);

    expect(tree).toEqual(saved);
    expect(openShellPanes(tree).has("timeline")).toBe(false);
  });

  it("keeps the first of two panels claiming one pane", () => {
    const tree = sanitizeShellLayout("vfx", {
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
    const tree = sanitizeShellLayout("vfx", {
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
    const tree = sanitizeShellLayout("vfx", {
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
