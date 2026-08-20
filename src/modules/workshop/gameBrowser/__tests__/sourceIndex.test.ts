import { describe, expect, it } from "vitest";

import {
  buildIndexTree,
  buildSourceTree,
  flattenSourceTree,
  hasOnlyUnknownPaths,
  holdsOnlyUnknown,
  type SourceDirListing,
  type SourceDirNode,
  type SourceEntry,
  type SourceFileNode,
  type SourceTreeNode,
  toggled,
  UNKNOWN_DIR,
  wadBasename,
  wadDirname,
} from "../sourceIndex";

let hashCounter = 0;

function known(path: string, sizeBytes = 0): SourceEntry {
  hashCounter += 1;
  return {
    pathHash: hashCounter.toString(16).padStart(16, "0"),
    path,
    sizeBytes,
    wad: "Test.wad.client",
  };
}

function unknown(pathHash: string, sizeBytes = 0): SourceEntry {
  return { pathHash, path: null, sizeBytes, wad: "Test.wad.client" };
}

/* A loading node carries no name, so the assertions name it by its type. */
function nameOf(node: SourceTreeNode): string {
  return node.type === "loading" ? "(loading)" : node.name;
}

describe("buildSourceTree", () => {
  it("returns an empty array for no entries", () => {
    expect(buildSourceTree([])).toEqual([]);
  });

  it("places a single file at the root under its basename", () => {
    const tree = buildSourceTree([known("readme.md")]);
    expect(tree).toHaveLength(1);
    const file = tree[0] as SourceFileNode;
    expect(file.type).toBe("file");
    expect(file.name).toBe("readme.md");
  });

  it("nests files under intermediate directories", () => {
    const tree = buildSourceTree([known("assets/textures/skin.dds"), known("assets/meta.json")]);
    expect(tree).toHaveLength(1);

    const assets = tree[0] as SourceDirNode;
    expect(assets.type).toBe("dir");
    expect(assets.name).toBe("assets");

    const textures = assets.children[0] as SourceDirNode;
    expect(textures.type).toBe("dir");
    expect(textures.name).toBe("textures");

    const skin = textures.children[0] as SourceFileNode;
    expect(skin.type).toBe("file");
    expect(skin.name).toBe("skin.dds");
    expect(skin.entry.path).toBe("assets/textures/skin.dds");
  });

  it("sorts directories before files, each group alphabetically", () => {
    const tree = buildSourceTree([
      known("z-file.bin"),
      known("a-file.bin"),
      known("m-dir/x.bin"),
      known("a-dir/x.bin"),
    ]);
    expect(tree.map(nameOf)).toEqual(["a-dir", "m-dir", "a-file.bin", "z-file.bin"]);
  });

  it("folds a run of directories that each hold only the next one", () => {
    const tree = buildSourceTree([known("data/characters/aatrox/skin0.bin")]);
    expect(tree).toHaveLength(1);

    const folded = tree[0] as SourceDirNode;
    expect(folded.name).toBe("data/characters/aatrox");
    expect(folded.id).toBe("d:data/characters/aatrox");
    expect(folded.children.map(nameOf)).toEqual(["skin0.bin"]);
  });

  it("stops folding at the directory that holds a file of its own", () => {
    const tree = buildSourceTree([known("a/b/c/deep.bin"), known("a/b/loose.bin")]);
    const ab = tree[0] as SourceDirNode;
    expect(ab.name).toBe("a/b");
    expect(ab.children.map(nameOf)).toEqual(["c", "loose.bin"]);
  });

  it("aggregates recursive file counts onto directory rows", () => {
    const tree = buildSourceTree([
      known("assets/a.bin"),
      known("assets/sub/b.bin"),
      known("assets/sub/c.bin"),
    ]);
    const assets = tree[0] as SourceDirNode;
    expect(assets.fileCount).toBe(3);

    const sub = assets.children[0] as SourceDirNode;
    expect(sub.fileCount).toBe(2);
  });

  it("groups entries without a path under one unknown node, after everything else", () => {
    const tree = buildSourceTree([
      unknown("00000000000000ff"),
      known("assets/a.bin"),
      known("loose.bin"),
      unknown("0000000000000001"),
    ]);

    expect(tree.map(nameOf)).toEqual(["assets", "loose.bin", "unknown"]);

    const group = tree[2] as SourceDirNode;
    expect(group.type).toBe("dir");
    expect(group.unknown).toBe(true);
    expect(group.fileCount).toBe(2);
    expect(group.children.map(nameOf)).toEqual(["0000000000000001", "00000000000000ff"]);

    const hashRow = group.children[0] as SourceFileNode;
    expect(hashRow.entry.path).toBeNull();
  });

  it("namespaces every node id with the given prefix", () => {
    const entries = [known("assets/a.bin"), unknown("00000000000000aa")];
    const plain = buildSourceTree(entries);
    const prefixed = buildSourceTree(entries, "wad::");

    const ids = (nodes: readonly { id: string }[]) => nodes.map((node) => node.id);
    expect(ids(prefixed)).toEqual(ids(plain).map((id) => `wad::${id}`));
  });
});

function listing(
  dirs: Array<[path: string, name: string, fileCount: number]>,
  files: SourceEntry[] = [],
): SourceDirListing {
  return {
    dirs: dirs.map(([path, name, fileCount]) => ({ path, name, fileCount })),
    files,
  };
}

describe("buildIndexTree", () => {
  const listings = new Map<string, SourceDirListing | null>([
    ["", listing([["assets", "assets", 3]], [known("readme.txt")])],
    ["assets", listing([["assets/characters/aatrox", "characters/aatrox", 2]])],
    ["assets/characters/aatrox", listing([], [known("assets/characters/aatrox/skin0.bin")])],
  ]);

  it("builds the root, directories before files", () => {
    const nodes = buildIndexTree(listings, () => false);
    expect(nodes.map(nameOf)).toEqual(["assets", "readme.txt"]);
    expect(nodes[0]!.type).toBe("dir");
  });

  it("leaves a shut directory without children, so nothing is read for it", () => {
    const [assets] = buildIndexTree(listings, () => false) as [SourceDirNode];
    expect(assets.children).toEqual([]);
    /* The count comes off the listing rather than off children the tree does
       not hold yet, which is what lets a shut row still report its size. */
    expect(assets.fileCount).toBe(3);
  });

  it("takes an open directory's children from its own listing", () => {
    const [assets] = buildIndexTree(listings, (path) => path === "assets") as [SourceDirNode];
    expect(assets.children.map(nameOf)).toEqual(["characters/aatrox"]);
  });

  it("addresses a folded row by the path it opens", () => {
    const [assets] = buildIndexTree(listings, (path) => path === "assets") as [SourceDirNode];
    const [folded] = assets.children as [SourceDirNode];

    expect(folded.name).toBe("characters/aatrox");
    expect(folded.id).toBe("assets/characters/aatrox");
  });

  it("shows a loading row while an open directory's listing is in flight", () => {
    const inFlight = new Map(listings);
    inFlight.set("assets", null);

    const [assets] = buildIndexTree(inFlight, (path) => path === "assets") as [SourceDirNode];
    expect(assets.children).toHaveLength(1);
    expect(assets.children[0]!.type).toBe("loading");
  });

  it("names a file by the last segment of its path", () => {
    const open = (path: string) => path === "assets" || path === "assets/characters/aatrox";
    const [assets] = buildIndexTree(listings, open) as [SourceDirNode];
    const [aatrox] = assets.children as [SourceDirNode];

    expect(aatrox.children.map(nameOf)).toEqual(["skin0.bin"]);
  });

  it("marks the unnamed group, wherever the index puts it", () => {
    const nodes = buildIndexTree(
      new Map([["", listing([[UNKNOWN_DIR, "unknown", 2]])]]),
      () => false,
    ) as [SourceDirNode];

    expect(nodes[0]!.unknown).toBe(true);
  });
});

describe("holdsOnlyUnknown", () => {
  it("is true when the root holds the unnamed group alone", () => {
    expect(holdsOnlyUnknown(listing([[UNKNOWN_DIR, "unknown", 2]]))).toBe(true);
  });

  it("is false once anything is named", () => {
    expect(
      holdsOnlyUnknown(
        listing([
          ["assets", "assets", 1],
          [UNKNOWN_DIR, "unknown", 2],
        ]),
      ),
    ).toBe(false);
    expect(holdsOnlyUnknown(listing([], [known("a.bin")]))).toBe(false);
    expect(holdsOnlyUnknown(listing([]))).toBe(false);
  });
});

describe("flattenSourceTree", () => {
  const tree = buildSourceTree([known("data/a.bin"), known("data/b.bin")]);

  it("keeps a shut directory's row but drops its children", () => {
    const rows = flattenSourceTree(tree, () => false);
    expect(rows.map((row) => nameOf(row.node))).toEqual(["data"]);
  });

  it("walks open directories with increasing depth", () => {
    const rows = flattenSourceTree(tree, () => true);
    expect(rows.map((row) => [nameOf(row.node), row.depth])).toEqual([
      ["data", 0],
      ["a.bin", 1],
      ["b.bin", 1],
    ]);
  });
});

describe("hasOnlyUnknownPaths", () => {
  it("is false for no entries", () => {
    expect(hasOnlyUnknownPaths([])).toBe(false);
  });

  it("is true only when every entry lacks a path", () => {
    expect(hasOnlyUnknownPaths([unknown("00000000000000aa")])).toBe(true);
    expect(hasOnlyUnknownPaths([unknown("00000000000000aa"), known("a.bin")])).toBe(false);
  });
});

describe("wadBasename", () => {
  it("drops the directories the install nests an archive under", () => {
    expect(wadBasename("Champions/Aatrox.wad.client")).toBe("Aatrox.wad.client");
    expect(wadBasename("Aatrox.wad.client")).toBe("Aatrox.wad.client");
  });
});

describe("wadDirname", () => {
  it("returns the directories the install nests an archive under", () => {
    expect(wadDirname("Champions/Aatrox.wad.client")).toBe("Champions");
    expect(wadDirname("Maps/Shipping/Map11/Map11.wad.client")).toBe("Maps/Shipping/Map11");
  });

  it("is empty for an archive at the root", () => {
    expect(wadDirname("UI.wad.client")).toBe("");
  });
});

describe("toggled", () => {
  it("adds an absent value and removes a present one", () => {
    const once = toggled(new Set(), "a");
    expect(once.has("a")).toBe(true);
    const twice = toggled(once, "a");
    expect(twice.has("a")).toBe(false);
  });
});
