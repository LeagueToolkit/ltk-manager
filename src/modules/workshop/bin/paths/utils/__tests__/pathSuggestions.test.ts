import { describe, expect, it } from "vitest";

import type { ContentEntry, ContentTree, GameSearchHit } from "@/lib/tauri";

import type { SourceEntry } from "../../../../gameBrowser/utils/sourceIndex";
import {
  archiveOf,
  matchProjectFiles,
  openingGroups,
  type PathGroup,
  type ProjectFile,
  projectFiles,
  searchGroups,
} from "../pathSuggestions";

const TEXTURES = ["dds", "tex"];

function entry(relativePath: string, ignored = false): ContentEntry {
  return {
    relativePath,
    sizeBytes: 64n,
    kind: "unknown",
    objects: [],
    ignoredBy: ignored ? { pattern: "*.psd", source: ".modignore", line: 1 } : null,
  };
}

function tree(layers: Record<string, ContentEntry[]>): ContentTree {
  return {
    layers: Object.entries(layers).map(([name, entries]) => ({
      name,
      fileCount: entries.length,
      totalSizeBytes: 0n,
      entries,
      ignoredDirectories: [],
    })),
  };
}

function file(path: string, layer = "base"): ProjectFile {
  return { path, layer, relativePath: `Ahri.wad.client/${path}` };
}

function hit(path: string, wad = "Champions/Ahri.wad.client"): GameSearchHit {
  const cut = path.lastIndexOf("/");
  return {
    pathHash: "00aa00aa00aa00aa",
    name: path.slice(cut + 1),
    path: path.slice(0, Math.max(cut, 0)),
    wad,
    band: 0,
    score: 1,
    nameRanges: [],
    pathRanges: [],
  };
}

function listed(path: string): SourceEntry {
  return { pathHash: "00bb00bb00bb00bb", path, sizeBytes: 64, wad: "Champions/Ahri.wad.client" };
}

/** Each group's paths, by group. */
function paths(groups: readonly PathGroup[]): Record<string, string[]> {
  return Object.fromEntries(
    groups.map((group) => [group.value, group.items.map((item) => item.path)]),
  );
}

describe("projectFiles", () => {
  it("names each file inside an archive directory by its chunk path", () => {
    const files = projectFiles(
      tree({
        base: [
          entry("Ahri.wad.client/ASSETS/Characters/Ahri/glow.dds"),
          entry("README.md"),
          entry("notes/glow.dds"),
        ],
      }),
    );

    expect(files).toEqual([
      {
        path: "ASSETS/Characters/Ahri/glow.dds",
        layer: "base",
        relativePath: "Ahri.wad.client/ASSETS/Characters/Ahri/glow.dds",
      },
    ]);
  });

  it("leaves out a file the ignore rules keep from shipping", () => {
    const files = projectFiles(tree({ base: [entry("Ahri.wad.client/assets/a.dds", true)] }));

    expect(files).toEqual([]);
  });
});

describe("matchProjectFiles", () => {
  const files = [
    file("assets/particles/glow_ring.scb"),
    file("assets/particles/ahri_glow.dds"),
    file("assets/glow/trail.dds"),
    file("assets/particles/fire.dds"),
  ];

  it("ranks the expected kind first, then a name the query opens", () => {
    expect(matchProjectFiles(files, "glow", TEXTURES).map((match) => match.path)).toEqual([
      "assets/particles/ahri_glow.dds",
      "assets/glow/trail.dds",
      "assets/particles/glow_ring.scb",
    ]);
  });

  it("matches nothing for a blank query", () => {
    expect(matchProjectFiles(files, "  ", TEXTURES)).toEqual([]);
  });
});

describe("openingGroups", () => {
  const current = "ASSETS/Characters/Ahri/Skins/Base/Particles/ahri_q.dds";

  it("lists the project's files of the kind, then the current path's folder", () => {
    const groups = openingGroups(
      [file("assets/mod/new_glow.dds"), file("assets/mod/new_mesh.scb")],
      current,
      TEXTURES,
      [
        listed("assets/characters/ahri/skins/base/particles/ahri_q.dds"),
        listed("assets/characters/ahri/skins/base/particles/ahri_w.dds"),
      ],
    );

    expect(paths(groups)).toEqual({
      project: ["assets/mod/new_glow.dds"],
      folder: [
        "assets/characters/ahri/skins/base/particles/ahri_q.dds",
        "assets/characters/ahri/skins/base/particles/ahri_w.dds",
      ],
    });
    expect(groups[1]?.items[0]?.current).toBe(true);
  });

  it("shows a project file of the folder once, as the project's", () => {
    const sibling = file("assets/characters/ahri/skins/base/particles/ahri_w.dds");
    const groups = openingGroups([sibling], current, TEXTURES, [
      listed("assets/characters/ahri/skins/base/particles/ahri_w.dds"),
    ]);

    expect(paths(groups)).toEqual({ project: [sibling.path] });
  });

  it("drops a group with nothing in it", () => {
    expect(openingGroups([], "", TEXTURES, [])).toEqual([]);
  });
});

describe("searchGroups", () => {
  it("lists the project's matches, then the game's that the project does not contain", () => {
    const groups = searchGroups([file("assets/characters/ahri/glow.dds")], "glow", "", TEXTURES, [
      hit("assets/characters/ahri/glow.dds"),
      hit("assets/shared/glow.dds", "Shared.wad.client"),
    ]);

    expect(paths(groups)).toEqual({
      project: ["assets/characters/ahri/glow.dds"],
      game: ["assets/shared/glow.dds"],
    });
    expect(groups[1]?.items[0]?.source).toEqual({
      kind: "game",
      wad: "Shared.wad.client",
      pathHash: "00aa00aa00aa00aa",
    });
  });

  it("leaves out a chunk no table names", () => {
    const groups = searchGroups([], "00aa", "", [], [hit("00aa00aa00aa00aa")]);

    expect(groups).toEqual([]);
  });
});

describe("archiveOf", () => {
  it("reads a layer file's archive directory", () => {
    expect(
      archiveOf({ kind: "layer", project: "p", layer: "base", path: "Ahri.wad.client/data/a.bin" }),
    ).toBe("Ahri.wad.client");
  });

  it("reads a game chunk's archive file name", () => {
    expect(
      archiveOf({ kind: "gameChunk", wad: "Champions/Ahri.wad.client", pathHash: "00aa" }),
    ).toBe("Ahri.wad.client");
  });

  it("reads none outside an archive", () => {
    expect(archiveOf({ kind: "file", path: "C:/a.bin" })).toBeNull();
    expect(archiveOf(null)).toBeNull();
  });
});
