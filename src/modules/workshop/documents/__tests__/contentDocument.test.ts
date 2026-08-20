import { describe, expect, it } from "vitest";

import { type ContentDocument, type ContentDocumentOf, previewDocument } from "../contentDocument";

/* Every factory in this file returns the union, so a test that reads a
   preview's own fields narrows first. */
function asPreview(document: ContentDocument): ContentDocumentOf<"preview"> {
  if (document.kind !== "preview") throw new Error(`expected a preview, got ${document.kind}`);
  return document;
}

describe("previewDocument", () => {
  it("names a layer file after the file", () => {
    const document = asPreview(
      previewDocument({
        kind: "layer",
        project: "C:/mods/skin",
        layer: "base",
        path: "assets/characters/smolder/hud/icon.tex",
      }),
    );

    expect(document.title).toBe("icon.tex");
    expect(document.context).toBe("base");
    expect(document.path).toBe("C:/mods/skin/content/base/assets/characters/smolder/hud/icon.tex");
  });

  /* A chunk reference holds a hash and no path, so a document built from one
     alone reads as hex. The tree row is what knows the resolved path. */
  it("takes the path the caller resolved over the hash the reference holds", () => {
    const asset = {
      kind: "gameChunk",
      wad: "Champions/Aatrox.wad.client",
      pathHash: "0123456789abcdef",
    } as const;

    expect(asPreview(previewDocument(asset)).title).toBe("0123456789abcdef");

    const named = asPreview(
      previewDocument(asset, "assets/characters/aatrox/hud/aatrox_square_0.aatrox.dds"),
    );
    expect(named.title).toBe("aatrox_square_0.aatrox.dds");
    expect(named.context).toBe("Aatrox");
    expect(named.path).toBe(
      "Champions/Aatrox.wad.client/assets/characters/aatrox/hud/aatrox_square_0.aatrox.dds",
    );
  });

  /* The resolved path is display only, so two spellings of one chunk are one tab. */
  it("keys on the reference and not on the resolved path", () => {
    const asset = { kind: "gameChunk", wad: "UI.wad.client", pathHash: "abc" } as const;

    expect(previewDocument(asset, "hud/icon.tex").id).toBe(previewDocument(asset).id);
  });
});
