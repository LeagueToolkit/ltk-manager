// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type {
  AssetRef,
  BinRow,
  ContentTree,
  DeclaredObjects,
  GameFileEntry,
  WorkshopProject,
} from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { nameHash } from "../../../shared/utils/binHash";
import {
  entryChunkPath,
  joinDeclarations,
  layerDeclarations,
  linkHashes,
  linkPaths,
  LinkAssetContext,
  linkStringKeys,
  type RowGroup,
  useCheckLinkTargets,
  useLayerCopy,
} from "../useLinkTargets";

const ENTRY = "0x2a1f3c7d";

function row(path: string, value: BinRow["value"]): BinRow {
  return {
    entry: ENTRY,
    path,
    label: path,
    node: "property",
    name: path,
    unnamed: false,
    kind: "string",
    value,
    declared: null,
  };
}

const ROOTS: readonly BinRow[] = [
  row("0000000a", { type: "objectLink", hash: "0x00000002", name: null }),
  row("0000000b", { type: "hash", hash: "0x00000001", name: "weapon" }),
  row("0000000c", { type: "objectLink", hash: "0x00000002", name: null }),
  row("0000000d", { type: "string", value: "text" }),
  row("0000000e", { type: "wadChunkLink", hash: "00cc", path: "assets/aatrox.tex" }),
  row("0000000f", { type: "wadChunkLink", hash: "00dd", path: null }),
  row("00000010", { type: "string", value: "ASSETS/Characters/Aatrox/Aatrox.dds" }),
];

describe("linkHashes and linkPaths", () => {
  it("collect a group's link and hash targets, sorted and each once", () => {
    expect(linkHashes(ROOTS)).toEqual(
      [
        "0x00000001",
        "0x00000002",
        nameHash("text"),
        nameHash("ASSETS/Characters/Aatrox/Aatrox.dds"),
      ].sort(),
    );
    expect(linkPaths(ROOTS)).toEqual(
      ["assets/aatrox.tex", "assets/characters/aatrox/aatrox.dds"].sort(),
    );
  });
});

const KEY_ROWS: readonly BinRow[] = [
  row("00000011", { type: "string", value: "hud_Chat_Team" }),
  row("00000012", { type: "string", value: "hud_Chat_Party" }),
  row("00000013", { type: "string", value: "hud_Chat_Party" }),
  row("00000014", { type: "string", value: "Idle" }),
  row("00000015", { type: "string", value: "Justicar Aatrox" }),
  row("00000016", { type: "string", value: "ASSETS/Shared/some_texture.dds" }),
  row("00000017", { type: "hash", hash: "0x00000001", name: "hud_chat" }),
];

describe("linkStringKeys", () => {
  it("collects the strings shaped like a string-table key, sorted and each once", () => {
    expect(linkStringKeys(KEY_ROWS)).toEqual(["hud_Chat_Party", "hud_Chat_Team"]);
  });
});

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DECLARED: DeclaredObjects = {
  index: { status: "ready" },
  objects: {
    "0x00000002": {
      path: "Characters/Aatrox",
      declarations: [
        {
          asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" },
          file: "data/characters/aatrox/aatrox.bin",
          classHash: "0x1",
          class: "CharacterRecord",
        },
      ],
    },
  },
};

const LOCATED: Record<string, GameFileEntry> = {
  "assets/aatrox.tex": {
    pathHash: "00cc",
    path: "assets/aatrox.tex",
    sizeBytes: 1,
    wad: "Champions/Aatrox.wad.client",
  },
};

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) => {
    if (command === "declared_objects") return Promise.resolve({ ok: true, value: DECLARED });
    if (command === "locate_game_files") return Promise.resolve({ ok: true, value: LOCATED });
    return Promise.resolve({ ok: false, error: { code: "UNKNOWN" } });
  });
});

describe("useCheckLinkTargets", () => {
  it("checks a group's targets in one call per kind, against the open document", async () => {
    const groups: RowGroup[] = [{ key: "", rows: ROOTS }];
    const { result } = renderHook(() => useCheckLinkTargets(7, groups), { wrapper: Providers });

    await waitFor(() => expect(result.current.pending).toBe(false));

    const declaredCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === "declared_objects",
    );
    expect(declaredCalls).toEqual([
      ["declared_objects", { objectHashes: linkHashes(ROOTS), document: 7 }],
    ]);
    const locatedCalls = mockInvoke.mock.calls.filter(
      ([command]) => command === "locate_game_files",
    );
    expect(locatedCalls).toEqual([["locate_game_files", { paths: linkPaths(ROOTS) }]]);

    expect(result.current.index).toEqual({ status: "ready" });
    expect(result.current.declared.get("0x00000002")?.path).toBe("Characters/Aatrox");
    expect(result.current.declared.has("0x00000001")).toBe(false);
    expect(result.current.located.get("assets/aatrox.tex")?.wad).toBe(
      "Champions/Aatrox.wad.client",
    );
  });

  it("answers a group's string-table keys with their in-game lines, outside pending", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "lookup_string_values") {
        return Promise.resolve({ ok: true, value: { hud_Chat_Party: "Party" } });
      }
      return Promise.resolve({ ok: true, value: { index: { status: "ready" }, objects: {} } });
    });
    const groups: RowGroup[] = [{ key: "", rows: KEY_ROWS }];
    const { result } = renderHook(() => useCheckLinkTargets(7, groups), { wrapper: Providers });

    await waitFor(() => expect(result.current.strings.get("hud_Chat_Party")).toBe("Party"));
    expect(result.current.strings.has("hud_Chat_Team")).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith("lookup_string_values", {
      keys: ["hud_Chat_Party", "hud_Chat_Team"],
    });
  });

  it("makes no call for a group holding no target", () => {
    const groups: RowGroup[] = [{ key: "", rows: [row("0000000d", { type: "float", value: 1 })] }];
    const { result } = renderHook(() => useCheckLinkTargets(7, groups), { wrapper: Providers });

    expect(result.current.pending).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("layerDeclarations and joinDeclarations", () => {
  const tree: ContentTree = {
    layers: [
      {
        name: "base",
        fileCount: 1,
        totalSizeBytes: 1n,
        entries: [
          {
            relativePath: "data/aatrox.bin",
            sizeBytes: 1n,
            kind: "property_bin",
            objects: [
              {
                objectHash: "0x00000002",
                path: "Characters/Aatrox",
                class: "CharacterRecord",
                classHash: "0x1",
              },
              {
                objectHash: "0x00000009",
                path: "Characters/Ahri",
                class: "CharacterRecord",
                classHash: "0x1",
              },
            ],
            ignoredBy: null,
          },
        ],
        ignoredDirectories: [],
      },
    ],
  };

  it("reads the layers' declarations of the wanted hashes out of the content scan", () => {
    const declared = layerDeclarations(tree, "C:/mods/skin", new Set(["0x00000002"]));

    expect([...declared.keys()]).toEqual(["0x00000002"]);
    expect(declared.get("0x00000002")).toEqual({
      path: "Characters/Aatrox",
      declarations: [
        {
          asset: { kind: "layer", project: "C:/mods/skin", layer: "base", path: "data/aatrox.bin" },
          file: "data/aatrox.bin",
          classHash: "0x1",
          class: "CharacterRecord",
        },
      ],
    });
  });

  /* The install's order leads, which is the resolution order the backend set. */
  it("folds the layers' declarations in after the install's, and none twice", () => {
    const layers = layerDeclarations(tree, "C:/mods/skin", new Set(["0x00000002", "0x00000009"]));
    const install = new Map(Object.entries(DECLARED.objects));

    const joined = joinDeclarations(install, layers);
    expect(joined.get("0x00000002")?.declarations.map((d) => d.file)).toEqual([
      "data/characters/aatrox/aatrox.bin",
      "data/aatrox.bin",
    ]);
    expect(joined.get("0x00000009")?.declarations.map((d) => d.file)).toEqual(["data/aatrox.bin"]);
    expect(joinDeclarations(joined, layers)).toEqual(joined);
  });
});

describe("entryChunkPath", () => {
  /* A layer entry is addressed from the layer root, and a `file` value is not. */
  it("drops the archive directory a layer entry is addressed under", () => {
    expect(entryChunkPath("Smolder.wad.client/assets/characters/smolder/tx_cm.tex")).toBe(
      "assets/characters/smolder/tx_cm.tex",
    );
  });

  it("keeps the author's own casing, which the caller folds", () => {
    expect(entryChunkPath("Smolder.WAD.client/ASSETS/Foo.tex")).toBe("ASSETS/Foo.tex");
  });

  it("is null for a file that sits outside an archive directory", () => {
    expect(entryChunkPath("README.md")).toBeNull();
    expect(entryChunkPath("meta/info.json")).toBeNull();
  });
});

describe("useLayerCopy", () => {
  const PATH = "assets/characters/twistedfate/skins/base/twistedfate_base_2012_cm.tex";
  const PROJECT: WorkshopProject = {
    path: "C:/mods/tf",
    name: "tf",
    displayName: "Twisted Fate",
    version: "1.0.0",
    description: "",
    authors: [],
    tags: [],
    champions: [],
    maps: [],
    layers: [
      { name: "base", displayName: "Base", priority: 0, description: null, stringOverrides: {} },
      { name: "dice", displayName: "Dice", priority: 5, description: null, stringOverrides: {} },
    ],
    thumbnailPath: null,
    lastModified: "2026-09-25T12:00:00Z",
    location: "workshop",
    lastOpened: null,
    id: "id-tf",
  };

  function layer(name: string) {
    return {
      name,
      fileCount: 1,
      totalSizeBytes: 0n,
      ignoredDirectories: [],
      entries: [
        {
          relativePath: `TwistedFate.wad.client/${PATH}`,
          sizeBytes: 64n,
          kind: "texture" as const,
          objects: [],
          ignoredBy: null,
        },
      ],
    };
  }

  function copyFor(asset: AssetRef, tree: ContentTree) {
    mockInvoke.mockImplementation((command: string) =>
      command === "get_project_content_tree"
        ? Promise.resolve({ ok: true, value: tree })
        : Promise.reject(new Error(`unexpected command ${command}`)),
    );

    return renderHook(() => useLayerCopy(PATH), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Providers>
          <ProjectProvider project={PROJECT}>
            <LinkAssetContext value={asset}>{children}</LinkAssetContext>
          </ProjectProvider>
        </Providers>
      ),
    });
  }

  /* The tab's asset has no project. `useBinDocument` adds it only to the asset it opens. */
  const GAME_BIN: AssetRef = {
    kind: "gameChunk",
    wad: "Champions/TwistedFate.wad.client",
    pathHash: "00aa00aa00aa00aa",
  };

  it("answers a game bin open in the project with the project's copy", async () => {
    const { result } = copyFor(GAME_BIN, { layers: [layer("base")] });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.asset).toEqual({
      kind: "layer",
      project: PROJECT.path,
      layer: "base",
      path: `TwistedFate.wad.client/${PATH}`,
    });
  });

  it("takes the higher-priority layer for a bin of no layer, as the preview does", async () => {
    const { result } = copyFor(GAME_BIN, { layers: [layer("base"), layer("dice")] });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.title).toBe("Dice");
  });

  it("searches the document's layer first", async () => {
    const layerBin: AssetRef = {
      kind: "layer",
      project: PROJECT.path,
      layer: "base",
      path: "TwistedFate.wad.client/data/characters/twistedfate/skins/skin0.bin",
    };
    const { result } = copyFor(layerBin, { layers: [layer("base"), layer("dice")] });

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.title).toBe("Base");
  });

  it("answers a loose file with nothing", () => {
    const { result } = copyFor({ kind: "file", path: "C:/skin0.bin" }, { layers: [layer("base")] });

    expect(result.current).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
