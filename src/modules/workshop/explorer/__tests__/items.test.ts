import { describe, expect, it } from "vitest";

import type { SourceEntry } from "../../gameBrowser/sourceIndex";
import { UNKNOWN_DIR } from "../../gameBrowser/sourceIndex";
import { filesUnderPath, itemsOf, listingsOf } from "../items";

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

function unnamed(pathHash: string): SourceEntry {
  return { pathHash, path: null, sizeBytes: 0, wad: "Test.wad.client" };
}

describe("listingsOf", () => {
  it("keys a listing by every directory path, folded chains included", () => {
    const listings = listingsOf([known("a/b/c/one.dds"), known("a/b/c/two.dds")]);

    expect([...listings.keys()].sort()).toEqual(["", "a", "a/b", "a/b/c"]);
  });

  it("folds a run of single-child directories into one row", () => {
    const listings = listingsOf([known("a/b/c/one.dds")]);

    expect(listings.get("")?.dirs).toEqual([{ path: "a/b/c", name: "a/b/c", fileCount: 1 }]);
  });

  it("stops a fold where a directory holds a choice", () => {
    const listings = listingsOf([known("a/b/one.dds"), known("a/c/two.dds")]);

    expect(listings.get("")?.dirs).toEqual([{ path: "a", name: "a", fileCount: 2 }]);
    expect(listings.get("a")?.dirs.map((dir) => dir.name)).toEqual(["b", "c"]);
  });

  it("counts every file below a directory, not only its own", () => {
    const listings = listingsOf([known("a/one.dds"), known("a/b/two.dds"), known("a/b/three.dds")]);

    expect(listings.get("")?.dirs[0]).toEqual({ path: "a", name: "a", fileCount: 3 });
  });

  it("orders directories before files, each in natural order", () => {
    const listings = listingsOf([
      known("mip10.dds"),
      known("mip2.dds"),
      known("zdir/one.dds"),
      known("adir/one.dds"),
    ]);

    const root = listings.get("");
    expect(root?.dirs.map((dir) => dir.name)).toEqual(["adir", "zdir"]);
    expect(root?.files.map((file) => file.path)).toEqual(["mip2.dds", "mip10.dds"]);
  });

  it("gathers the entries no hash table names under one group at the root", () => {
    const listings = listingsOf([known("a/one.dds"), unnamed("00000000000000ff")]);

    expect(listings.get("")?.dirs.at(-1)).toEqual({
      path: UNKNOWN_DIR,
      name: "unknown",
      fileCount: 1,
    });
    expect(listings.get(UNKNOWN_DIR)?.files).toHaveLength(1);
  });

  it("keeps the unnamed group out of a listing that holds no unnamed entries", () => {
    const listings = listingsOf([known("a/one.dds")]);

    expect(listings.has(UNKNOWN_DIR)).toBe(false);
    expect(listings.get("")?.dirs.map((dir) => dir.path)).toEqual(["a"]);
  });
});

describe("itemsOf", () => {
  it("draws the directories first, then the files", () => {
    const listings = listingsOf([known("one.dds"), known("a/two.dds")]);
    const items = itemsOf(listings.get("")!);

    expect(items.map((item) => [item.kind, item.name])).toEqual([
      ["dir", "a"],
      ["file", "one.dds"],
    ]);
  });

  it("identifies a directory by its path and a file by its hash", () => {
    const entry = known("a/one.dds");
    const listings = listingsOf([entry]);

    expect(itemsOf(listings.get("")!)[0]?.id).toBe("a");
    expect(itemsOf(listings.get("a")!)[0]?.id).toBe(entry.pathHash);
  });

  it("names an entry no hash table resolves by its hash", () => {
    const listings = listingsOf([unnamed("00000000000000ff")]);

    expect(itemsOf(listings.get(UNKNOWN_DIR)!)[0]?.name).toBe("00000000000000ff");
  });
});

describe("filesUnderPath", () => {
  it("collects every file below a directory, however deep", () => {
    const listings = listingsOf([
      known("a/one.dds"),
      known("a/b/two.dds"),
      known("a/b/c/three.dds"),
      known("z/four.dds"),
    ]);

    expect(filesUnderPath(listings, "a").map((entry) => entry.path)).toEqual([
      "a/one.dds",
      "a/b/two.dds",
      "a/b/c/three.dds",
    ]);
  });

  it("answers nothing for a path the source does not hold", () => {
    expect(filesUnderPath(listingsOf([known("a/one.dds")]), "nowhere")).toEqual([]);
  });
});
