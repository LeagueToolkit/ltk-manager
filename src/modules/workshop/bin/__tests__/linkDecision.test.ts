import { describe, expect, it } from "vitest";

import type { BinValue, DeclaredObject, GameFileEntry, ObjectIndexStatus } from "@/lib/tauri";

import { nameHash } from "../binHash";
import {
  chunkPath,
  decideFileLink,
  decideHash,
  decideLink,
  decideObjectLink,
  decideStringLink,
} from "../linkDecision";
import type { LinkTargets } from "../useLinkTargets";

const HASH = "0x2a1f3c7d";
const CHUNK = { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" } as const;

const DECLARED: DeclaredObject = {
  path: "Characters/Aatrox/Skins/Skin0/Resources",
  declarations: [
    {
      asset: CHUNK,
      file: "data/characters/aatrox/skins/skin0.bin",
      classHash: "0x9b67e9f6",
      class: "SkinCharacterDataProperties",
    },
    {
      asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00bb" },
      file: "data/characters/aatrox/skins/skin1.bin",
      classHash: "0x9b67e9f6",
      class: "SkinCharacterDataProperties",
    },
  ],
};

const LOCATED: GameFileEntry = {
  pathHash: "00cc",
  path: "assets/characters/aatrox/aatrox.tex",
  sizeBytes: 12n,
  wad: "Champions/Aatrox.wad.client",
};

function targets(overrides: Partial<LinkTargets> = {}): LinkTargets {
  return { index: null, declared: new Map(), located: new Map(), pending: false, ...overrides };
}

const ready: ObjectIndexStatus = { status: "ready" };

describe("decideObjectLink", () => {
  /* The backend ordered the declarations, so the first one is the resolution. */
  it("opens the first declaration of a declared target", () => {
    const decision = decideObjectLink(
      HASH,
      targets({ index: ready, declared: new Map([[HASH, DECLARED]]) }),
    );

    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.document).toMatchObject({
      kind: "object",
      asset: CHUNK,
      objectHash: HASH,
      objectPath: DECLARED.path,
      file: "data/characters/aatrox/skins/skin0.bin",
    });
  });

  it("is text where the ready index declares nothing", () => {
    expect(decideObjectLink(HASH, targets({ index: ready })).kind).toBe("text");
    expect(
      decideObjectLink(
        HASH,
        targets({ index: { status: "failed", error: { code: "X" } as never } }),
      ).kind,
    ).toBe("text");
  });

  it("warms the index for a target outside the file while the index is absent or building", () => {
    expect(decideObjectLink(HASH, targets({ index: { status: "absent" } })).kind).toBe("warm");
    expect(decideObjectLink(HASH, targets({ index: { status: "building" } })).kind).toBe("warm");
  });

  /* The file's own objects answer with the index absent. */
  it("opens a target the file itself declares whatever the index says", () => {
    const decision = decideObjectLink(
      HASH,
      targets({ index: { status: "absent" }, declared: new Map([[HASH, DECLARED]]) }),
    );
    expect(decision.kind).toBe("chip");
  });

  it("waits while the check has not answered", () => {
    expect(decideObjectLink(HASH, targets({ pending: true })).kind).toBe("pending");
    expect(decideObjectLink(HASH, targets()).kind).toBe("text");
  });
});

describe("decideHash", () => {
  it("is a chip only where the index declares an object under it", () => {
    expect(
      decideHash(HASH, targets({ index: ready, declared: new Map([[HASH, DECLARED]]) })).kind,
    ).toBe("chip");
    expect(decideHash(HASH, targets({ index: ready })).kind).toBe("text");
    expect(decideHash(HASH, targets({ index: { status: "absent" } })).kind).toBe("text");
  });
});

describe("decideFileLink", () => {
  const path = "assets/characters/aatrox/aatrox.tex";
  const layer = {
    asset: {
      kind: "layer",
      project: "C:/mods/skin",
      layer: "base",
      path: "ASSETS/Characters/Aatrox/Aatrox.tex",
    },
    title: "Base",
  } as const;

  it("is text for a path nothing resolves", () => {
    expect(decideFileLink(null, targets({ located: new Map([[path, LOCATED]]) }), layer).kind).toBe(
      "text",
    );
  });

  it("answers from the layer first and carries the layer's title", () => {
    const decision = decideFileLink(path, targets({ located: new Map([[path, LOCATED]]) }), layer);

    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.side).toBe("Base");
    expect(decision.document).toMatchObject({ kind: "preview", asset: layer.asset });
  });

  it("answers from the install second and carries the archive's name", () => {
    const decision = decideFileLink(path, targets({ located: new Map([[path, LOCATED]]) }), null);

    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.side).toBe("Aatrox");
    expect(decision.document).toMatchObject({
      kind: "preview",
      asset: { kind: "gameChunk", wad: LOCATED.wad, pathHash: LOCATED.pathHash },
      title: "aatrox.tex",
    });
  });

  it("is missing where neither side holds the path, and pending while the check runs", () => {
    expect(decideFileLink(path, targets(), null).kind).toBe("missing");
    expect(decideFileLink(path, targets({ pending: true }), null).kind).toBe("pending");
  });

  /* A hash no table names says nothing about whether the chunk is there. */
  it("is text for a path no table resolved, rather than missing", () => {
    expect(decideFileLink(null, targets(), null).kind).toBe("text");
  });
});

describe("chunkPath", () => {
  it("takes an assets or a data path with an extension, whatever its case", () => {
    expect(chunkPath("ASSETS/Characters/Aatrox/Aatrox.dds")).toBe(
      "assets/characters/aatrox/aatrox.dds",
    );
    expect(chunkPath("DATA/Characters/Aatrox/Aatrox.bin")).toBe(
      "data/characters/aatrox/aatrox.bin",
    );
  });

  it("takes nothing under another root", () => {
    expect(chunkPath("Characters/Aatrox/Aatrox.dds")).toBeNull();
    expect(chunkPath("Justicar Aatrox")).toBeNull();
  });

  it("takes nothing without an extension on the last segment", () => {
    expect(chunkPath("assets/characters/aatrox")).toBeNull();
    expect(chunkPath("assets/characters.old/aatrox")).toBeNull();
    expect(chunkPath("assets/characters/aatrox.")).toBeNull();
    expect(chunkPath("assets/characters/.dds")).toBeNull();
  });
});

describe("decideStringLink", () => {
  const path = "assets/characters/aatrox/aatrox.tex";
  /* The object the index declares under the FNV-1a of the string below. */
  const named = "Characters/Aatrox/Skins/Skin0/Resources";
  const namedHash = nameHash(named);

  it("opens the chunk a path resolves to", () => {
    const decision = decideStringLink(
      "ASSETS/Characters/Aatrox/Aatrox.tex",
      targets({ located: new Map([[path, LOCATED]]) }),
      () => null,
    );

    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.document).toMatchObject({ kind: "preview", title: "aatrox.tex" });
  });

  it("opens the object its hash declares", () => {
    const decision = decideStringLink(
      named,
      targets({ index: ready, declared: new Map([[namedHash, DECLARED]]) }),
      () => null,
    );

    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.document).toMatchObject({ kind: "object", objectHash: namedHash });
  });

  it("takes the chunk where both sides answer", () => {
    const both = targets({
      index: ready,
      declared: new Map([[nameHash(path), DECLARED]]),
      located: new Map([[path, LOCATED]]),
    });

    const decision = decideStringLink(path, both, () => null);
    expect(decision.kind).toBe("chip");
    if (decision.kind !== "chip") return;
    expect(decision.document.kind).toBe("preview");
  });

  it("is text where neither side answers, and missing where a path names no chunk", () => {
    expect(decideStringLink(named, targets({ index: ready }), () => null).kind).toBe("text");
    expect(decideStringLink(path, targets({ index: ready }), () => null).kind).toBe("missing");
  });

  /* A string is not a link the reader asked to follow, so a miss never builds the index. */
  it("never warms the index", () => {
    expect(decideStringLink(named, targets({ index: { status: "absent" } }), () => null).kind).toBe(
      "text",
    );
  });
});

describe("decideLink", () => {
  const checked = targets({
    index: ready,
    declared: new Map([[HASH, DECLARED]]),
    located: new Map([[LOCATED.path ?? "", LOCATED]]),
  });

  it("routes each link kind and answers null for a value that is no link", () => {
    const link: BinValue = { type: "objectLink", hash: HASH, name: null };
    const hash: BinValue = { type: "hash", hash: HASH, name: null };
    const file: BinValue = { type: "wadChunkLink", hash: "00cc", path: LOCATED.path };
    const text: BinValue = { type: "string", value: LOCATED.path ?? "" };
    const number: BinValue = { type: "float", value: 1 };

    expect(decideLink(link, checked, () => null)?.kind).toBe("chip");
    expect(decideLink(hash, checked, () => null)?.kind).toBe("chip");
    expect(decideLink(file, checked, () => null)?.kind).toBe("chip");
    expect(decideLink(text, checked, () => null)?.kind).toBe("chip");
    expect(decideLink(number, checked, () => null)).toBeNull();
  });
});
