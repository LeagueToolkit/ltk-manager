import { describe, expect, it } from "vitest";

import { texturesOverHeld } from "../texturesOverHeld";

const ASSETS = new Map([
  ["kept", {}],
  ["landed", {}],
]);

describe("texturesOverHeld", () => {
  it("answers a key that has not landed with its held texture", () => {
    const shown = texturesOverHeld(ASSETS, new Map([["kept", "old"]]), new Map());

    expect(shown.get("kept")).toBe("old");
  });

  it("prefers a landed texture over the held one", () => {
    const shown = texturesOverHeld(
      ASSETS,
      new Map([["landed", "old"]]),
      new Map([["landed", "new"]]),
    );

    expect(shown.get("landed")).toBe("new");
  });

  it("returns the held map itself if a new set lands the same textures", () => {
    const held = new Map([
      ["kept", "same"],
      ["landed", "same"],
    ]);

    expect(texturesOverHeld(ASSETS, held, new Map(held))).toBe(held);
  });

  it("drops a held key that the set no longer asks for", () => {
    const shown = texturesOverHeld(ASSETS, new Map([["gone", "old"]]), new Map());

    expect(shown.has("gone")).toBe(false);
  });
});
