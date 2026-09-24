import type { ContentTree } from "@/lib/tauri";

import { declarationsOn, holdsDeclarations } from "../declarationsOn";

function tree(...layers: (readonly string[])[]): ContentTree {
  return {
    layers: layers.map((paths, at) => ({
      name: `layer${at}`,
      fileCount: paths.length,
      totalSizeBytes: 0n,
      entries: paths.map((relativePath) => ({
        relativePath,
        sizeBytes: 0n,
        kind: "unknown",
        objects: [],
        ignoredBy: null,
      })),
      ignoredDirectories: [],
    })),
  };
}

describe("holdsDeclarations", () => {
  it.each(["game_data.yaml", "game_data.yml", "game_data.toml", "game_data.json"])(
    "reads %s at a layer's root as declarations",
    (name) => {
      expect(holdsDeclarations(tree(["data/a.bin"], [name]))).toBe(true);
    },
  );

  it("reads no manifest below a layer's root", () => {
    expect(holdsDeclarations(tree(["data/game_data.yaml"]))).toBe(false);
  });

  it("reads a project with no layer as declaring nothing", () => {
    expect(holdsDeclarations(tree())).toBe(false);
  });
});

describe("declarationsOn", () => {
  it("follows the project's choice over what its layers hold", () => {
    expect(declarationsOn(false, tree(["game_data.yaml"]))).toBe(false);
    expect(declarationsOn(true, tree([]))).toBe(true);
  });

  it("defaults to whether a layer declares", () => {
    expect(declarationsOn(undefined, tree(["game_data.yaml"]))).toBe(true);
    expect(declarationsOn(undefined, tree(["data/a.bin"]))).toBe(false);
  });

  it("is unknown while the content scan has not answered", () => {
    expect(declarationsOn(undefined, undefined)).toBeNull();
  });
});
