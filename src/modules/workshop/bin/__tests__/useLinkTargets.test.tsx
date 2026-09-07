// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { BinRow, ContentTree, DeclaredObjects, GameFileEntry } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { nameHash } from "../binHash";
import {
  joinDeclarations,
  layerDeclarations,
  linkHashes,
  linkPaths,
  type RowGroup,
  useCheckLinkTargets,
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
    sizeBytes: 1n,
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
          },
        ],
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
