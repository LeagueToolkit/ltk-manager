import { describe, expect, it } from "vitest";

import { nameHash } from "../../../bin/shared/utils/binHash";
import { objectPreviewKind, playsOnHover } from "../objectPreview";
import type { ObjectRowNode } from "../objectTree";

function object(className: string): ObjectRowNode {
  return {
    type: "object",
    id: "Characters/Viego/Skins/Skin43/Materials/Body",
    path: "Characters/Viego/Skins/Skin43/Materials/Body",
    name: "Body",
    objectHash: "0x2a1f3c7d",
    unnamed: false,
    declarations: [
      {
        classHash: nameHash(className),
        class: className,
        asset: { kind: "gameChunk", wad: "Champions/Viego.wad.client", pathHash: "00aa" },
      } as ObjectRowNode["declarations"][number],
    ],
    layers: [],
    count: 0,
    children: [],
  };
}

describe("objectPreviewKind", () => {
  it("draws a material, a skin and a particle system, and nothing else", () => {
    expect(objectPreviewKind(object("StaticMaterialDef"))).toBe("material");
    expect(objectPreviewKind(object("SkinCharacterDataProperties"))).toBe("skin");
    expect(objectPreviewKind(object("VfxSystemDefinitionData"))).toBe("vfx");
    expect(objectPreviewKind(object("CharacterRecord"))).toBeNull();
  });
});

describe("playsOnHover", () => {
  it("plays every kind with a preview on hover, a character on its turntable", () => {
    expect(playsOnHover("material")).toBe(true);
    expect(playsOnHover("vfx")).toBe(true);
    expect(playsOnHover("skin")).toBe(true);
    expect(playsOnHover(null)).toBe(false);
  });
});
