import { describe, expect, it } from "vitest";

import type { BinRow, BinValue } from "@/lib/tauri";

import { extensionOf, pathFieldOf } from "../pathField";

function row(name: string, value: BinValue, overrides: Partial<BinRow> = {}): BinRow {
  return {
    entry: "0x2a1f3c7d",
    path: "0000000a",
    label: name,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
    ...overrides,
  };
}

const text = (value: string): BinValue => ({ type: "string", value });

describe("pathFieldOf", () => {
  it("gives every file value a field, of the kind its path names", () => {
    const field = pathFieldOf(
      row("mAnimationFilePath", {
        type: "wadChunkLink",
        hash: "00aa00aa00aa00aa",
        path: "assets/characters/ahri/animations/idle.anm",
      }),
    );

    expect(field).toEqual({ extensions: ["anm"], enterPicks: true });
  });

  it("gives a string containing a path a field, whatever the property is called", () => {
    const field = pathFieldOf(row("mName", text("ASSETS/Shared/Particles/glow.dds")));

    expect(field?.extensions).toContain("dds");
    expect(field?.enterPicks).toBe(true);
  });

  it("reads the kind an empty field expects off its property name", () => {
    expect(pathFieldOf(row("particleColorTexture", text("")))?.extensions).toContain("tex");
    expect(pathFieldOf(row("texture", text("")))?.extensions).toContain("dds");
    expect(pathFieldOf(row("mSimpleMeshName", text("")))?.extensions).toContain("scb");
    expect(pathFieldOf(row("skeleton", text("")))?.extensions).toEqual(["skl"]);
    expect(pathFieldOf(row("iconCircle", text("")))?.extensions).toContain("dds");
    expect(pathFieldOf(row("erosionMapName", text("")))?.extensions).toContain("dds");
  });

  it("prefers the current path's kind over the one the name implies", () => {
    expect(pathFieldOf(row("texture", text("assets/x/glow.scb")))?.extensions).toContain("scb");
  });

  it("expects no kind of a path field whose name says none", () => {
    expect(pathFieldOf(row("mFilePath", text("")))).toEqual({ extensions: [], enterPicks: true });
  });

  it("leaves a string that is neither a path nor a path field's as plain text", () => {
    expect(pathFieldOf(row("mName", text("Ahri Q")))).toBeNull();
    expect(pathFieldOf(row("mapName", text("")))).toBeNull();
    expect(pathFieldOf(row("mPath", text("")))).toBeNull();
    expect(pathFieldOf(row("0x1a2b3c4d", text(""), { unnamed: true }))).toBeNull();
  });

  it("keeps Enter for the typed text in a path field containing other text", () => {
    expect(pathFieldOf(row("mTextureName", text("placeholder")))?.enterPicks).toBe(false);
  });

  it("gives other kinds no field", () => {
    expect(pathFieldOf(row("texture", { type: "hash", hash: "0x1", name: null }))).toBeNull();
  });
});

describe("extensionOf", () => {
  it("reads the name's extension lowercased", () => {
    expect(extensionOf("ASSETS/A.B/Glow.DDS")).toBe("dds");
  });

  it("reads none for a name without one, or a dotfile", () => {
    expect(extensionOf("assets/a.b/glow")).toBe("");
    expect(extensionOf("assets/.hidden")).toBe("");
  });
});
