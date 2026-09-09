import { describe, expect, it } from "vitest";

import type { SourceEntry, SourceTreeNode } from "../../gameBrowser/sourceIndex";
import type { ExplorerItem } from "../items";
import { sortItems, sortTree } from "../sort";

let hashCounter = 0;

function entry(path: string, sizeBytes: number): SourceEntry {
  hashCounter += 1;
  return {
    pathHash: hashCounter.toString(16).padStart(16, "0"),
    path,
    sizeBytes,
    wad: "Test.wad.client",
  };
}

function file(name: string, sizeBytes = 0): ExplorerItem {
  const made = entry(name, sizeBytes);
  return { kind: "file", id: made.pathHash, name, entry: made };
}

function dir(name: string, fileCount = 1): ExplorerItem {
  return { kind: "dir", id: name, name, fileCount };
}

function names(items: readonly ExplorerItem[]): string[] {
  return items.map((item) => item.name);
}

describe("sortItems", () => {
  it("orders by name, numbers as numbers", () => {
    const sorted = sortItems([file("mip10.dds"), file("mip2.dds")], {
      field: "name",
      direction: "asc",
    });

    expect(names(sorted)).toEqual(["mip2.dds", "mip10.dds"]);
  });

  it("reverses the names under a descending sort", () => {
    const sorted = sortItems([file("a.dds"), file("b.dds")], {
      field: "name",
      direction: "desc",
    });

    expect(names(sorted)).toEqual(["b.dds", "a.dds"]);
  });

  it("keeps the directories ahead of the files whatever the direction", () => {
    const rows = [file("a.dds"), dir("z"), file("b.dds")];

    expect(names(sortItems(rows, { field: "name", direction: "desc" }))[0]).toBe("z");
    expect(names(sortItems(rows, { field: "size", direction: "desc" }))[0]).toBe("z");
  });

  it("orders by size, largest last under an ascending sort", () => {
    const sorted = sortItems([file("big.dds", 900), file("small.dds", 10)], {
      field: "size",
      direction: "asc",
    });

    expect(names(sorted)).toEqual(["small.dds", "big.dds"]);
  });

  it("falls back to the name where two files share a size", () => {
    const sorted = sortItems([file("b.dds", 10), file("a.dds", 10)], {
      field: "size",
      direction: "asc",
    });

    expect(names(sorted)).toEqual(["a.dds", "b.dds"]);
  });

  it("leaves the directories in name order under a size sort, since none totals one", () => {
    const sorted = sortItems([dir("z", 900), dir("a", 1)], { field: "size", direction: "asc" });

    expect(names(sorted)).toEqual(["a", "z"]);
  });

  it("groups by kind, and by name inside one kind", () => {
    const sorted = sortItems([file("b.bin"), file("a.dds"), file("a.bin")], {
      field: "kind",
      direction: "asc",
    });

    expect(names(sorted)).toEqual(["a.bin", "b.bin", "a.dds"]);
  });
});

describe("sortTree", () => {
  function fileNode(name: string, sizeBytes = 0): SourceTreeNode {
    const made = entry(name, sizeBytes);
    return { type: "file", id: `f:${made.pathHash}`, name, entry: made };
  }

  it("sorts every depth, not the open directory alone", () => {
    const tree: SourceTreeNode[] = [
      {
        type: "dir",
        id: "d:a",
        path: "a",
        name: "a",
        unknown: false,
        fileCount: 2,
        children: [fileNode("small.dds", 10), fileNode("big.dds", 900)],
      },
    ];

    const inner = sortTree(tree, { field: "size", direction: "desc" })[0];
    const children = inner?.type === "dir" ? inner.children : [];

    expect(children.map((child) => (child.type === "loading" ? "" : child.name))).toEqual([
      "big.dds",
      "small.dds",
    ]);
  });

  it("leaves a directory still reading its listing at the end", () => {
    const tree: SourceTreeNode[] = [
      { type: "loading", id: "l:a" },
      fileNode("a.dds"),
      { type: "dir", id: "d:z", path: "z", name: "z", unknown: false, fileCount: 0, children: [] },
    ];

    expect(sortTree(tree, { field: "name", direction: "asc" }).map((node) => node.type)).toEqual([
      "dir",
      "file",
      "loading",
    ]);
  });
});
