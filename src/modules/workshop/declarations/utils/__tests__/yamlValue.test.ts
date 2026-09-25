import { describe, expect, it } from "vitest";

import { summarizeValue, tokenizeYamlLine, type YamlToken } from "../yamlValue";

const kinds = (line: string) =>
  tokenizeYamlLine(line)
    .filter((token) => token.kind !== "space")
    .map((token) => [token.kind, token.text]);

describe("tokenizeYamlLine", () => {
  it("reads a struct tag's kind and class, and a flow mapping's keys and scalars", () => {
    expect(
      kinds("- !embed(StaticMaterialShaderParamDef) {name: Outline_Width, value: [4.6, 0]}"),
    ).toEqual([
      ["punct", "-"],
      ["tag", "!embed"],
      ["punct", "("],
      ["class", "StaticMaterialShaderParamDef"],
      ["punct", ")"],
      ["punct", "{"],
      ["key", "name"],
      ["punct", ":"],
      ["scalar", "Outline_Width"],
      ["punct", ","],
      ["key", "value"],
      ["punct", ":"],
      ["punct", "["],
      ["scalar", "4.6"],
      ["punct", ","],
      ["scalar", "0"],
      ["punct", "]"],
      ["punct", "}"],
    ]);
  });

  it("tells a quoted key from a quoted value, and keeps a comment whole", () => {
    expect(kinds('"0x0b03bf5a": "4" # count')).toEqual([
      ["key", '"0x0b03bf5a"'],
      ["punct", ":"],
      ["string", '"4"'],
      ["comment", "# count"],
    ]);
  });

  it("reads a negative number as a scalar, not a list item", () => {
    expect(kinds("[-20, 0]")).toEqual([
      ["punct", "["],
      ["scalar", "-20"],
      ["punct", ","],
      ["scalar", "0"],
      ["punct", "]"],
    ]);
  });

  it("keeps every character of the line", () => {
    const line = '  - !pointer(LerpMaterialDriver) {mOnValue: 0.0, name: "a: b"}';

    expect(
      tokenizeYamlLine(line)
        .map((token) => token.text)
        .join(""),
    ).toBe(line);
  });
});

const text = (tokens: readonly YamlToken[]) => tokens.map((token) => token.text).join("");

describe("summarizeValue", () => {
  it("draws a one-line value as spelled", () => {
    const summary = summarizeValue("[Mods/jade-outline/OutlineSwitch]");

    expect(summary.kind === "line" && text(summary.tokens)).toBe(
      "[Mods/jade-outline/OutlineSwitch]",
    );
  });

  it("reads a reference's target, tagged or as a one-key mapping", () => {
    expect(summarizeValue('!ref "Characters/Teemo/Skins/Skin1:iconAvatar"')).toEqual({
      kind: "reference",
      target: "Characters/Teemo/Skins/Skin1:iconAvatar",
    });
    expect(summarizeValue("{ref: Skin1:iconAvatar}")).toEqual({
      kind: "reference",
      target: "Skin1:iconAvatar",
    });
  });

  it("reads a struct by its kind and class, as a tag and in the document form", () => {
    const tagged = ["!pointer(DynamicMaterialDef)", "parameters:", "  - a: 1"].join("\n");
    const document = [
      "pointer:",
      "  class: VfxAnimatedVector3fVariableData",
      "  set:",
      "    probabilityTables:",
      "      - pointer:",
      "          class: VfxProbabilityTableData",
    ].join("\n");

    expect(summarizeValue(tagged)).toEqual({
      kind: "struct",
      tag: { name: "pointer", className: "DynamicMaterialDef" },
    });
    expect(summarizeValue(document)).toEqual({
      kind: "struct",
      tag: { name: "pointer", className: "VfxAnimatedVector3fVariableData" },
    });
  });

  it("counts a block list whose items share a struct class", () => {
    const value = [
      "- !embed(StaticMaterialShaderParamDef) {name: A, value: [1, 0, 0, 0]}",
      "- !embed(StaticMaterialShaderParamDef) {name: B, value: [2, 0, 0, 0]}",
    ].join("\n");

    expect(summarizeValue(value)).toEqual({
      kind: "structs",
      items: 2,
      tag: { name: "embed", className: "StaticMaterialShaderParamDef" },
    });
  });

  it("folds a block list into brackets and a block mapping into braces", () => {
    const list = summarizeValue("- [90.0, 35.0, 1.0]\n- [90.0, 35.0, 1.0]");
    const mapping = summarizeValue("keyTimes: [0.0, 1.0]\nvalues:\n  - 1\n  - 2");

    expect(list.kind === "line" && text(list.tokens)).toBe(
      "[[90.0, 35.0, 1.0], [90.0, 35.0, 1.0]]",
    );
    expect(mapping.kind === "line" && text(mapping.tokens)).toBe(
      "{keyTimes: [0.0, 1.0], values: …}",
    );
  });
});
