import { describe, expect, it } from "vitest";

import type {
  ContentTree,
  ObjectDeclaration,
  ObjectDirListing,
  ObjectFindHit,
  ObjectNodeEntry,
  WorkshopProject,
} from "@/lib/tauri";

import {
  activation,
  ancestorPrefixes,
  branchIds,
  buildFindTree,
  buildObjectTree,
  expandable,
  flattenObjectTree,
  holdsOnlyUnnamed,
  isBelowPrefix,
  layerDeclarationsOf,
  NO_LAYER_DECLARATIONS,
  type ObjectPrefixNode,
  type ObjectRowNode,
  type ObjectTreeNode,
  rangesInName,
  UNNAMED_PREFIX,
} from "../objectTree";

function chunk(file: string, cls = "SkinCharacterDataProperties"): ObjectDeclaration {
  return {
    asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" },
    file,
    classHash: "0x0000001",
    class: cls,
  };
}

function object(
  path: string,
  count = 0,
  declarations = [chunk("data/skin0.bin")],
): ObjectNodeEntry {
  const cut = path.lastIndexOf("/");
  return {
    objectHash: `0x${path.length.toString(16).padStart(8, "0")}`,
    path,
    name: cut < 0 ? path : path.slice(cut + 1),
    declarations,
    count,
  };
}

/* `name` is the folded run the backend names the row by, the last segment where none folds. */
function prefix(
  path: string,
  count: number,
  name = path.slice(path.lastIndexOf("/") + 1),
): ObjectDirListing["prefixes"][number] {
  return { path, name, count };
}

const ROOT: ObjectDirListing = {
  prefixes: [
    prefix("characters", 5),
    prefix("maps/shipping/map11", 1, "maps/shipping/map11"),
    prefix("?", 2),
  ],
  objects: [],
};

const SKINS: ObjectDirListing = {
  prefixes: [],
  objects: [object("characters/aatrox/skins/skin0", 1), object("characters/aatrox/skins/skin2")],
};

const SKIN0: ObjectDirListing = {
  prefixes: [],
  objects: [object("characters/aatrox/skins/skin0/resources")],
};

function nameOf(node: ObjectTreeNode): string {
  if (node.type === "loading") return "(loading)";
  if (node.type === "more") return `(${node.count} more)`;
  return node.name;
}

function asObject(node: ObjectTreeNode | undefined): ObjectRowNode {
  if (node?.type !== "object") throw new Error(`expected an object, got ${node?.type}`);
  return node;
}

function asPrefix(node: ObjectTreeNode | undefined): ObjectPrefixNode {
  if (node?.type !== "prefix") throw new Error(`expected a prefix, got ${node?.type}`);
  return node;
}

describe("buildObjectTree", () => {
  it("draws the root's prefixes shut, the unnamed group flagged", () => {
    const tree = buildObjectTree(new Map([["", ROOT]]), () => false, NO_LAYER_DECLARATIONS);

    expect(tree.map(nameOf)).toEqual(["characters", "maps/shipping/map11", UNNAMED_PREFIX]);
    expect(asPrefix(tree[0]).count).toBe(5);
    expect(asPrefix(tree[0]).children).toEqual([]);
    expect(asPrefix(tree[2]).unnamed).toBe(true);
    expect(asPrefix(tree[1]).id).toBe("maps/shipping/map11");
  });

  it("puts a loading row under an expanded prefix whose listing is in flight", () => {
    const expanded = new Set(["characters"]);
    const tree = buildObjectTree(
      new Map([
        ["", ROOT],
        ["characters", null],
      ]),
      (path) => expanded.has(path),
      NO_LAYER_DECLARATIONS,
    );

    expect(asPrefix(tree[0]).children.map(nameOf)).toEqual(["(loading)"]);
  });

  it("draws a node that is an object and a prefix as one row with its children under it", () => {
    const expanded = new Set(["characters/aatrox/skins", "characters/aatrox/skins/skin0"]);
    const listings = new Map<string, ObjectDirListing | null>([
      ["", { prefixes: [prefix("characters/aatrox/skins", 3)], objects: [] }],
      ["characters/aatrox/skins", SKINS],
      ["characters/aatrox/skins/skin0", SKIN0],
    ]);
    const tree = buildObjectTree(listings, (path) => expanded.has(path), NO_LAYER_DECLARATIONS);

    const skins = asPrefix(tree[0]);
    expect(skins.children.map(nameOf)).toEqual(["skin0", "skin2"]);
    const skin0 = asObject(skins.children[0]);
    expect(skin0.count).toBe(1);
    expect(expandable(skin0)).toBe(true);
    expect(skin0.children.map(nameOf)).toEqual(["resources"]);
    expect(expandable(asObject(skins.children[1]))).toBe(false);
  });

  it("asks for nothing under an expanded leaf", () => {
    const expanded = new Set(["characters/aatrox/skins", "characters/aatrox/skins/skin2"]);
    const listings = new Map<string, ObjectDirListing | null>([
      ["", { prefixes: [prefix("characters/aatrox/skins", 3)], objects: [] }],
      ["characters/aatrox/skins", SKINS],
    ]);
    const tree = buildObjectTree(listings, (path) => expanded.has(path), NO_LAYER_DECLARATIONS);

    expect(asObject(asPrefix(tree[0]).children[1]).children).toEqual([]);
  });

  it("joins the layers' declarations onto the node, marked by their titles, and lists no row for them", () => {
    const shared = object("characters/shared", 1, [chunk("data/a.bin"), chunk("data/b.bin")]);
    const project: WorkshopProject = {
      path: "C:/mods/skin",
      layers: [{ name: "base", displayName: "Base" }],
    } as unknown as WorkshopProject;
    const content: ContentTree = {
      layers: [
        {
          name: "base",
          entries: [
            {
              relativePath: "data/shared.bin",
              sizeBytes: 1n,
              kind: "propertyBin",
              objects: [
                {
                  objectHash: shared.objectHash,
                  path: shared.path,
                  class: "Shared",
                  classHash: "0x0000002",
                },
              ],
            },
          ],
        },
      ],
    } as unknown as ContentTree;
    const layers = layerDeclarationsOf(content, project);
    const expanded = new Set(["characters", "characters/shared"]);
    const listings = new Map<string, ObjectDirListing | null>([
      ["", { prefixes: [prefix("characters", 2)], objects: [] }],
      ["characters", { prefixes: [], objects: [shared] }],
      ["characters/shared", { prefixes: [], objects: [object("characters/shared/child")] }],
    ]);

    const tree = buildObjectTree(listings, (path) => expanded.has(path), layers);
    const node = asObject(asPrefix(tree[0]).children[0]);

    expect(node.layers).toEqual([{ name: "base", title: "Base" }]);
    expect(node.declarations.map((declaration) => declaration.file)).toEqual([
      "data/a.bin",
      "data/b.bin",
      "data/shared.bin",
    ]);
    expect(node.declarations[2]?.asset.kind).toBe("layer");
    expect(node.children.map(nameOf)).toEqual(["child"]);
  });

  it("keeps an object one layer alone joins a leaf, marked by the layer", () => {
    const only = object("characters/only");
    const project = { path: "C:/mods/skin", layers: [] } as unknown as WorkshopProject;
    const content = {
      layers: [
        {
          name: "base",
          entries: [
            {
              relativePath: "data/only.bin",
              sizeBytes: 1n,
              kind: "propertyBin",
              objects: [
                { objectHash: only.objectHash, path: only.path, class: "C", classHash: "0x1" },
              ],
            },
          ],
        },
      ],
    } as unknown as ContentTree;
    const tree = buildObjectTree(
      new Map([["", { prefixes: [], objects: [only] }]]),
      () => false,
      layerDeclarationsOf(content, project),
    );

    const node = asObject(tree[0]);
    expect(node.count).toBe(0);
    expect(expandable(node)).toBe(false);
    expect(node.declarations).toHaveLength(2);
    expect(node.layers).toEqual([{ name: "base", title: "base" }]);
  });

  it("flags an object no table names", () => {
    const unnamed: ObjectNodeEntry = {
      objectHash: "0x12345678",
      path: "0x12345678",
      name: "0x12345678",
      declarations: [chunk("data/a.bin")],
      count: 0,
    };
    const tree = buildObjectTree(
      new Map([[UNNAMED_PREFIX, { prefixes: [], objects: [unnamed] }]]),
      () => true,
      NO_LAYER_DECLARATIONS,
    );
    /* The root is what the tree builds from. The unnamed listing is read through it. */
    expect(tree.map(nameOf)).toEqual(["(loading)"]);

    const rooted = buildObjectTree(
      new Map<string, ObjectDirListing | null>([
        ["", { prefixes: [prefix(UNNAMED_PREFIX, 1)], objects: [] }],
        [UNNAMED_PREFIX, { prefixes: [], objects: [unnamed] }],
      ]),
      () => true,
      NO_LAYER_DECLARATIONS,
    );
    expect(asObject(asPrefix(rooted[0]).children[0]).unnamed).toBe(true);
  });
});

describe("activation", () => {
  const both = asObject(
    buildObjectTree(
      new Map([["", { prefixes: [], objects: [object("a/b", 2)] }]]),
      () => false,
      NO_LAYER_DECLARATIONS,
    )[0],
  );
  const leaf = asObject(
    buildObjectTree(
      new Map([["", { prefixes: [], objects: [object("a/c")] }]]),
      () => false,
      NO_LAYER_DECLARATIONS,
    )[0],
  );
  const dir = asPrefix(
    buildObjectTree(
      new Map([["", { prefixes: [prefix("a", 3)], objects: [] }]]),
      () => false,
      NO_LAYER_DECLARATIONS,
    )[0],
  );

  it("toggles a prefix from anywhere on the row", () => {
    expect(activation(dir, "row")).toBe("toggle");
    expect(activation(dir, "caret")).toBe("toggle");
  });

  it("opens a node that is both from its body and toggles it from its caret alone", () => {
    expect(activation(both, "row")).toBe("open");
    expect(activation(both, "caret")).toBe("toggle");
  });

  it("opens a leaf from either", () => {
    expect(activation(leaf, "row")).toBe("open");
    expect(activation(leaf, "caret")).toBe("open");
  });

  it("does nothing for a loading row or the more row", () => {
    expect(activation({ type: "loading", id: "l" }, "row")).toBe("none");
    expect(activation({ type: "more", id: "more", count: 3 }, "row")).toBe("none");
  });
});

describe("buildFindTree", () => {
  function hit(path: string, ranges: [number, number][] = []): ObjectFindHit {
    return {
      objectHash: `0x${path.length.toString(16).padStart(8, "0")}`,
      path,
      ranges,
      declarations: [chunk("data/objects.bin")],
    };
  }

  it("nests the hits under their prefixes, folded, in natural order", () => {
    const tree = buildFindTree(
      [
        hit("characters/aatrox/skins/skin0"),
        hit("characters/aatrox/skins/skin0/resources"),
        hit("characters/aatrox/skins/skin10"),
        hit("characters/aatrox/skins/skin2"),
        hit("characters/ahri/skins/skin0"),
        hit("maps/shipping/map11/data"),
      ],
      6,
      NO_LAYER_DECLARATIONS,
      () => true,
    );

    expect(tree.map(nameOf)).toEqual(["characters", "maps/shipping/map11"]);
    const characters = asPrefix(tree[0]);
    expect(characters.count).toBe(5);
    expect(characters.children.map(nameOf)).toEqual(["aatrox/skins", "ahri/skins"]);
    const skins = asPrefix(characters.children[0]);
    expect(skins.id).toBe("characters/aatrox/skins");
    expect(skins.children.map(nameOf)).toEqual(["skin0", "skin2", "skin10"]);
    const skin0 = asObject(skins.children[0]);
    expect(skin0.count).toBe(1);
    expect(skin0.children.map(nameOf)).toEqual(["resources"]);
  });

  it("carries the marked runs and shuts what the reader shut", () => {
    const shut = new Set(["characters/aatrox/skins"]);
    const tree = buildFindTree(
      [hit("characters/aatrox/skins/skin0", [[24, 29]])],
      1,
      NO_LAYER_DECLARATIONS,
      (path) => !shut.has(path),
    );

    const skins = asPrefix(tree[0]);
    expect(skins.id).toBe("characters/aatrox/skins");
    expect(skins.children).toEqual([]);

    const open = buildFindTree(
      [hit("characters/aatrox/skins/skin0", [[24, 29]])],
      1,
      NO_LAYER_DECLARATIONS,
      () => true,
    );
    expect(asObject(asPrefix(open[0]).children[0]).ranges).toEqual([[24, 29]]);
  });

  it("gathers the unnamed under the question mark last and closes with the rows the cap left", () => {
    const unnamed: ObjectFindHit = {
      objectHash: "0x12345678",
      path: "0x12345678",
      ranges: [[2, 6]],
      declarations: [chunk("data/a.bin")],
    };
    const tree = buildFindTree(
      [hit("characters/aatrox"), unnamed],
      42,
      NO_LAYER_DECLARATIONS,
      () => true,
    );

    expect(tree.map(nameOf)).toEqual(["characters", UNNAMED_PREFIX, "(40 more)"]);
    expect(asPrefix(tree[0]).children.map(nameOf)).toEqual(["aatrox"]);
    const group = asPrefix(tree[1]);
    expect(group.unnamed).toBe(true);
    expect(asObject(group.children[0]).unnamed).toBe(true);
  });
});

describe("flattenObjectTree", () => {
  it("walks open branches with their depth", () => {
    const expanded = new Set([
      "characters",
      "characters/aatrox/skins",
      "characters/aatrox/skins/skin0",
    ]);
    const tree = buildObjectTree(
      new Map<string, ObjectDirListing | null>([
        ["", { prefixes: [prefix("characters", 3)], objects: [] }],
        [
          "characters",
          { prefixes: [prefix("characters/aatrox/skins", 3, "aatrox/skins")], objects: [] },
        ],
        ["characters/aatrox/skins", SKINS],
        ["characters/aatrox/skins/skin0", SKIN0],
      ]),
      (path) => expanded.has(path),
      NO_LAYER_DECLARATIONS,
    );

    const rows = flattenObjectTree(tree, (node) => expanded.has(node.id));
    expect(rows.map((row) => [nameOf(row.node), row.depth])).toEqual([
      ["characters", 0],
      ["aatrox/skins", 1],
      ["skin0", 2],
      ["resources", 3],
      ["skin2", 2],
    ]);
  });
});

describe("rangesInName", () => {
  it("keeps the part of each run that falls in the last segment, re-based on it", () => {
    const path = "characters/aatrox/skins/skin0";
    expect(rangesInName(path, [[24, 29]])).toEqual([[0, 5]]);
    expect(rangesInName(path, [[18, 28]])).toEqual([[0, 4]]);
    expect(rangesInName(path, [[0, 10]])).toEqual([]);
    expect(rangesInName("root", [[1, 3]])).toEqual([[1, 3]]);
    expect(rangesInName(path, undefined)).toEqual([]);
  });
});

describe("holdsOnlyUnnamed", () => {
  it("is true for a root of nothing but the unnamed group", () => {
    expect(holdsOnlyUnnamed({ prefixes: [prefix(UNNAMED_PREFIX, 4)], objects: [] })).toBe(true);
    expect(holdsOnlyUnnamed(ROOT)).toBe(false);
    expect(holdsOnlyUnnamed({ prefixes: [], objects: [] })).toBe(false);
  });
});

describe("ancestorPrefixes", () => {
  it("names every prefix down to the object, outermost first", () => {
    expect(ancestorPrefixes("characters/aatrox/skins/skin0")).toEqual([
      "characters",
      "characters/aatrox",
      "characters/aatrox/skins",
    ]);
    expect(ancestorPrefixes("root")).toEqual([]);
  });

  it("puts a hash under the unnamed group", () => {
    expect(ancestorPrefixes("0x12345678")).toEqual([UNNAMED_PREFIX]);
  });
});

describe("isBelowPrefix", () => {
  it("takes every path under the prefix and leaves out the prefix and its siblings", () => {
    expect(isBelowPrefix("characters/aatrox/skins", "characters")).toBe(true);
    expect(isBelowPrefix("characters", "characters")).toBe(false);
    expect(isBelowPrefix("charactersx/aatrox", "characters")).toBe(false);
  });

  it("puts a hash under the unnamed group", () => {
    expect(isBelowPrefix("0x12345678", UNNAMED_PREFIX)).toBe(true);
  });
});

describe("branchIds", () => {
  it("names every foldable node at any depth, an object with objects under it too", () => {
    const tree = buildFindTree(
      [
        "characters/aatrox/skins/skin0",
        "characters/aatrox/skins/skin0/resources",
        "characters/aatrox/skins/skin2",
        "characters/ahri/skins/skin0",
        "maps/shipping/map11/data",
      ].map((path) => ({
        objectHash: `0x${path.length.toString(16).padStart(8, "0")}`,
        path,
        ranges: [],
        declarations: [chunk("data/objects.bin")],
      })),
      5,
      NO_LAYER_DECLARATIONS,
      () => true,
    );

    expect(branchIds(tree).sort()).toEqual([
      "characters",
      "characters/aatrox/skins",
      "characters/aatrox/skins/skin0",
      "characters/ahri/skins",
      "maps/shipping/map11",
    ]);
  });
});
