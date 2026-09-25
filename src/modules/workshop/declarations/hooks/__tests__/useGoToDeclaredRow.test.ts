import { describe, expect, it } from "vitest";

import type { DeclaredModule, DeclaredObjects, ObjectDeclaration } from "@/lib/tauri";

import { declaringChunk } from "../useGoToDeclaredRow";

function chunk(pathHash: string): ObjectDeclaration {
  return {
    asset: { kind: "gameChunk", wad: "Champions/Teemo.wad.client", pathHash },
    file: `file-${pathHash}`,
    classHash: "0x00000001",
    class: "SkinCharacterDataProperties",
  };
}

const DECLARED: DeclaredObjects = {
  index: { status: "ready" },
  objects: {
    "0x1234abcd": {
      path: "Characters/Teemo/Skins/Skin0",
      declarations: [chunk("aaaaaaaaaaaaaaaa"), chunk("bbbbbbbbbbbbbbbb")],
    },
  },
};

const MODULE: DeclaredModule = {
  index: 0,
  name: null,
  note: null,
  selector: "target",
  target: "data/b.bin",
  targetHash: "bbbbbbbbbbbbbbbb",
  source: null,
  overrides: [],
  links: { add: [], remove: [] },
  span: null,
  entries: [],
};

const ENTRY = {
  name: "Characters/Teemo/Skins/Skin0",
  knownName: null,
  hash: "0x1234abcd",
  edit: 0,
  object: null,
  span: null,
  keys: [],
  links: { add: [], remove: [] },
};

describe("declaringChunk", () => {
  it("prefers the chunk a target module names", () => {
    const found = declaringChunk(DECLARED, { module: MODULE, entry: ENTRY, key: null });

    expect(found?.declaration.file).toBe("file-bbbbbbbbbbbbbbbb");
  });

  it("takes the first chunk for an entries module", () => {
    const module = { ...MODULE, selector: "entries" as const, target: null, targetHash: null };
    const found = declaringChunk(DECLARED, { module, entry: ENTRY, key: null });

    expect(found?.declaration.file).toBe("file-aaaaaaaaaaaaaaaa");
  });

  it("finds nothing for an object the game does not declare", () => {
    const entry = { ...ENTRY, hash: "0xffffffff" };

    expect(declaringChunk(DECLARED, { module: MODULE, entry, key: null })).toBeNull();
  });
});
