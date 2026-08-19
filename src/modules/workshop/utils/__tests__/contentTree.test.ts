import { describe, expect, it } from "vitest";

import type { ContentEntry } from "@/lib/tauri";

import {
  allDirPaths,
  buildContentTree,
  buildDirFileCounts,
  buildLayerWads,
  type DirNode,
  type FileNode,
  flattenTree,
  nodeCovers,
} from "../contentTree";

function entry(relativePath: string, sizeBytes = 0): ContentEntry {
  return {
    relativePath,
    sizeBytes: BigInt(sizeBytes),
    kind: "unknown",
  };
}

describe("buildContentTree", () => {
  it("returns an empty array for no entries", () => {
    expect(buildContentTree([])).toEqual([]);
  });

  it("places a single file at the root", () => {
    const tree = buildContentTree([entry("readme.md")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.type).toBe("file");
    expect(tree[0]!.name).toBe("readme.md");
  });

  it("nests files under intermediate directories", () => {
    const tree = buildContentTree([entry("assets/textures/skin.dds"), entry("assets/meta.json")]);
    expect(tree).toHaveLength(1);

    const assets = tree[0] as DirNode;
    expect(assets.type).toBe("dir");
    expect(assets.name).toBe("assets");
    expect(assets.path).toBe("assets");

    const textures = assets.children[0] as DirNode;
    expect(textures.type).toBe("dir");
    expect(textures.path).toBe("assets/textures");

    const skin = textures.children[0] as FileNode;
    expect(skin.type).toBe("file");
    expect(skin.name).toBe("skin.dds");
    expect(skin.entry.relativePath).toBe("assets/textures/skin.dds");
  });

  it("merges sibling files into the same directory node", () => {
    const tree = buildContentTree([
      entry("assets/a.bin"),
      entry("assets/b.bin"),
      entry("assets/sub/c.bin"),
    ]);
    expect(tree).toHaveLength(1);
    const assets = tree[0] as DirNode;
    expect(assets.children).toHaveLength(3);
    const names = assets.children.map((c) => c.name);
    expect(names).toEqual(["sub", "a.bin", "b.bin"]);
  });

  it("sorts directories before files within a directory, each group alphabetically", () => {
    const tree = buildContentTree([
      entry("z-file.bin"),
      entry("a-file.bin"),
      entry("m-dir/x.bin"),
      entry("a-dir/x.bin"),
    ]);
    const names = tree.map((c) => c.name);
    expect(names).toEqual(["a-dir", "m-dir", "a-file.bin", "z-file.bin"]);
  });

  it("ignores leading or duplicate slashes defensively", () => {
    const tree = buildContentTree([entry("//odd///path.bin")]);
    const odd = tree[0] as DirNode;
    expect(odd.name).toBe("odd");
    const file = odd.children[0] as FileNode;
    expect(file.name).toBe("path.bin");
  });
});

describe("buildContentTree folding", () => {
  it("folds a run of directories that each hold only the next one", () => {
    const tree = buildContentTree([entry("a/b/c/deep.bin")]);
    expect(tree).toHaveLength(1);

    const folded = tree[0] as DirNode;
    expect(folded.name).toBe("a/b/c");
    expect(folded.path).toBe("a/b/c");
    expect(folded.children.map((child) => child.name)).toEqual(["deep.bin"]);
  });

  it("names the folder holding the files as the last segment of the group", () => {
    const tree = buildContentTree([
      entry("Aatrox.wad.client/data/characters/aatrox/skin0.bin"),
      entry("Aatrox.wad.client/data/characters/aatrox/skin1.bin"),
    ]);

    const folded = tree[0] as DirNode;
    expect(folded.name).toBe("Aatrox.wad.client/data/characters/aatrox");
    expect(folded.path).toBe("Aatrox.wad.client/data/characters/aatrox");
    expect(folded.children.map((child) => child.name)).toEqual(["skin0.bin", "skin1.bin"]);
  });

  it("stops folding at the directory that holds a file of its own", () => {
    const tree = buildContentTree([entry("a/b/c/deep.bin"), entry("a/b/loose.bin")]);
    const ab = tree[0] as DirNode;
    expect(ab.name).toBe("a/b");
    expect(ab.path).toBe("a/b");
    expect(ab.children.map((child) => child.name)).toEqual(["c", "loose.bin"]);
  });

  it("stops folding at the directory that holds two directories", () => {
    const tree = buildContentTree([entry("a/b/x.bin"), entry("a/c/y.bin")]);
    const a = tree[0] as DirNode;
    expect(a.name).toBe("a");
    expect(a.children.map((child) => child.name)).toEqual(["b", "c"]);
  });

  it("folds each branch of a fork on its own", () => {
    const tree = buildContentTree([entry("a/b/one/x.bin"), entry("a/c/two/y.bin")]);
    const a = tree[0] as DirNode;
    expect(a.children.map((child) => child.name)).toEqual(["b/one", "c/two"]);
    expect((a.children[0] as DirNode).path).toBe("a/b/one");
  });

  it("counts a folded run against the path it kept", () => {
    const tree = buildContentTree([entry("a/b/c/one.bin"), entry("a/b/c/two.bin")]);
    const counts = buildDirFileCounts(tree);
    expect(counts.get("a/b/c")).toBe(2);
    expect(counts.has("a")).toBe(false);
  });
});

describe("nodeCovers", () => {
  it("matches a folded row by any directory on its run", () => {
    const tree = buildContentTree([entry("Aatrox.wad.client/data/skin.bin")]);
    const folded = tree[0] as DirNode;

    expect(nodeCovers(folded, "Aatrox.wad.client")).toBe(true);
    expect(nodeCovers(folded, "Aatrox.wad.client/data")).toBe(true);
    expect(nodeCovers(folded, "Aatrox.wad")).toBe(false);
    expect(nodeCovers(folded, "Ahri.wad.client")).toBe(false);
  });

  it("matches a file by its relative path", () => {
    const tree = buildContentTree([entry("a/b/skin.bin")]);
    const folded = tree[0] as DirNode;
    const file = folded.children[0] as FileNode;

    expect(nodeCovers(file, "a/b/skin.bin")).toBe(true);
    expect(nodeCovers(file, "a/b")).toBe(false);
  });
});

describe("flattenTree", () => {
  it("expands everything when nothing is collapsed", () => {
    const tree = buildContentTree([entry("a/file.bin"), entry("a/sub/deep.bin")]);
    const rows = flattenTree(tree, new Set());
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      "0:a",
      "1:sub",
      "2:deep.bin",
      "1:file.bin",
    ]);
  });

  it("returns only top-level rows when every directory is collapsed", () => {
    const tree = buildContentTree([entry("a/file.bin"), entry("b/nested/x.bin"), entry("c.bin")]);
    const rows = flattenTree(tree, allDirPaths(tree));
    expect(rows.map((r) => r.node.name)).toEqual(["a", "b/nested", "c.bin"]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it("stops descending past a collapsed directory", () => {
    const tree = buildContentTree([entry("a/sub/deep.bin"), entry("a/top.bin")]);
    // `a` stays open, `a/sub` is shut
    const rows = flattenTree(tree, new Set(["a/sub"]));
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual(["0:a", "1:sub", "1:top.bin"]);
  });

  /* The bug this shape exists to prevent: a rescan that adds a directory used
     to render it shut, because it was missing from a set seeded once. */
  it("renders a directory the scan has only just found as expanded", () => {
    const collapsed = new Set<string>();
    const before = buildContentTree([entry("a/one.bin")]);
    expect(flattenTree(before, collapsed).map((r) => r.node.name)).toEqual(["a", "one.bin"]);

    const after = buildContentTree([entry("a/one.bin"), entry("b/two.bin")]);
    expect(flattenTree(after, collapsed).map((r) => r.node.name)).toEqual([
      "a",
      "one.bin",
      "b",
      "two.bin",
    ]);
  });

  it("ignores a collapsed path that the tree no longer holds", () => {
    const tree = buildContentTree([entry("a/one.bin")]);
    const rows = flattenTree(tree, new Set(["gone", "also/gone"]));
    expect(rows.map((r) => r.node.name)).toEqual(["a", "one.bin"]);
  });
});

describe("allDirPaths", () => {
  it("collects every directory path", () => {
    const tree = buildContentTree([entry("a/x.bin"), entry("b/nested/y.bin"), entry("c.bin")]);
    const paths = allDirPaths(tree);
    expect(paths).toEqual(new Set(["a", "b/nested"]));
  });
});

describe("buildDirFileCounts", () => {
  it("counts files recursively per directory", () => {
    const tree = buildContentTree([
      entry("a/x.bin"),
      entry("a/y.bin"),
      entry("a/sub/z.bin"),
      entry("a/sub/deep/q.bin"),
      entry("b/top.bin"),
    ]);
    const counts = buildDirFileCounts(tree);
    expect(counts.get("a")).toBe(4);
    expect(counts.get("a/sub")).toBe(2);
    expect(counts.get("a/sub/deep")).toBe(1);
    expect(counts.get("b")).toBe(1);
  });

  it("returns an empty map for an empty tree", () => {
    expect(buildDirFileCounts([])).toEqual(new Map());
  });
});

describe("buildLayerWads", () => {
  it("returns nothing for an empty layer", () => {
    expect(buildLayerWads([])).toEqual([]);
  });

  it("rolls a WAD folder up into one row", () => {
    const wads = buildLayerWads([
      entry("Aatrox.wad.client/data/one.bin", 100),
      entry("Aatrox.wad.client/data/two.bin", 50),
      entry("Ahri.wad.client/data/three.bin", 25),
    ]);

    expect(wads).toEqual([
      {
        path: "Aatrox.wad.client",
        name: "Aatrox.wad.client",
        kind: "wad",
        fileCount: 2,
        sizeBytes: 150,
      },
      {
        path: "Ahri.wad.client",
        name: "Ahri.wad.client",
        kind: "wad",
        fileCount: 1,
        sizeBytes: 25,
      },
    ]);
  });

  it("keeps a loose root file as its own row", () => {
    const wads = buildLayerWads([entry("readme.md", 12)]);
    expect(wads).toEqual([
      { path: "readme.md", name: "readme.md", kind: "file", fileCount: 1, sizeBytes: 12 },
    ]);
  });
});
