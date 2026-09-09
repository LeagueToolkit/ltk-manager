import { describe, expect, it } from "vitest";

import type { SourceEntry, SourceTreeNode } from "../../gameBrowser/sourceIndex";
import { filterIsActive, filterItems, filterTree, kindGroupOf, NO_FILTER } from "../filter";
import type { ExplorerItem } from "../items";

let hashCounter = 0;

function entry(path: string | null): SourceEntry {
  hashCounter += 1;
  const pathHash = hashCounter.toString(16).padStart(16, "0");
  return { pathHash, path, sizeBytes: 0, wad: "Test.wad.client" };
}

function file(name: string): ExplorerItem {
  const made = entry(name);
  return { kind: "file", id: made.pathHash, name, entry: made };
}

function unnamedFile(): ExplorerItem {
  const made = entry(null);
  return { kind: "file", id: made.pathHash, name: made.pathHash, entry: made };
}

function dir(name: string): ExplorerItem {
  return { kind: "dir", id: name, name, fileCount: 1 };
}

function names(items: readonly ExplorerItem[]): string[] {
  return items.map((item) => item.name);
}

describe("kindGroupOf", () => {
  it("puts both texture containers in one group", () => {
    expect(kindGroupOf("texture")).toBe("textures");
    expect(kindGroupOf("texture_dds")).toBe("textures");
  });

  it("puts a kind no group claims in Other", () => {
    expect(kindGroupOf("unknown")).toBe("other");
  });
});

describe("filterIsActive", () => {
  it("reads nothing set as inactive", () => {
    expect(filterIsActive(NO_FILTER)).toBe(false);
  });

  it("reads any one of the three as active", () => {
    expect(filterIsActive({ ...NO_FILTER, text: "smolder" })).toBe(true);
    expect(filterIsActive({ ...NO_FILTER, kinds: new Set(["textures"]) })).toBe(true);
    expect(filterIsActive({ ...NO_FILTER, unnamedOnly: true })).toBe(true);
  });
});

describe("filterItems", () => {
  const rows = [dir("smolder"), dir("hud"), file("base_tx_cm.dds"), file("skin01.bin")];

  it("passes everything under no filter", () => {
    expect(filterItems(rows, NO_FILTER)).toHaveLength(4);
  });

  it("matches the text against a name, whatever its case", () => {
    expect(names(filterItems(rows, { ...NO_FILTER, text: "SKIN" }))).toEqual(["skin01.bin"]);
  });

  it("matches the text against a directory name too", () => {
    expect(names(filterItems(rows, { ...NO_FILTER, text: "hud" }))).toEqual(["hud"]);
  });

  it("keeps a kind the group holds and drops the rest", () => {
    const kept = filterItems(rows, { ...NO_FILTER, kinds: new Set(["textures"]) });

    expect(names(kept)).toContain("base_tx_cm.dds");
    expect(names(kept)).not.toContain("skin01.bin");
  });

  it("leaves every directory standing under a kind filter, so the location is no dead end", () => {
    const kept = filterItems(rows, { ...NO_FILTER, kinds: new Set(["textures"]) });

    expect(names(kept)).toEqual(["smolder", "hud", "base_tx_cm.dds"]);
  });

  it("keeps the chunks no hash table names under the unnamed switch", () => {
    const withUnnamed = [...rows, unnamedFile()];
    const kept = filterItems(withUnnamed, { ...NO_FILTER, unnamedOnly: true });

    expect(kept.filter((item) => item.kind === "file")).toHaveLength(1);
  });
});

describe("filterTree", () => {
  function fileNode(name: string): SourceTreeNode {
    const made = entry(name);
    return { type: "file", id: `f:${made.pathHash}`, name, entry: made };
  }

  const tree: SourceTreeNode[] = [
    {
      type: "dir",
      id: "d:characters",
      path: "characters",
      name: "characters",
      unknown: false,
      fileCount: 2,
      children: [fileNode("smolder.bin"), fileNode("aatrox.bin")],
    },
    fileNode("root.dds"),
  ];

  it("keeps a match, and every directory on the way to it", () => {
    const kept = filterTree(tree, "smolder");

    expect(kept).toHaveLength(1);
    const branch = kept[0];
    expect(branch?.type === "dir" && branch.children.map((child) => child.id)).toHaveLength(1);
  });

  it("keeps everything below a directory whose own name matches", () => {
    const kept = filterTree(tree, "characters");
    const branch = kept[0];

    expect(branch?.type === "dir" && branch.children).toHaveLength(2);
  });

  it("drops a branch holding no match at all", () => {
    expect(filterTree(tree, "nothing-here")).toHaveLength(0);
  });

  it("passes the tree through untouched for an empty pattern", () => {
    expect(filterTree(tree, "")).toBe(tree);
  });
});
