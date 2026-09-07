import { describe, expect, it } from "vitest";

import { fnv1a32, nameHash } from "../binHash";

/**
 * Names the meta schema's own snapshot resolves, read out of
 * `crates/ltk-manager-core/src/meta_schema/schema-snapshot.json.gz`.
 *
 * Every class a layout is keyed on and every field a layout or a value row names is
 * here, because a frontend hash that disagrees with the backend's places nothing.
 */
const KNOWN: ReadonlyArray<readonly [name: string, hash: string]> = [
  // The classes a layout or a value rule is keyed on
  ["StaticMaterialDef", "0xff9d3409"],
  ["StaticMaterialShaderSamplerDef", "0x0904b150"],
  ["StaticMaterialShaderParamDef", "0xde480eef"],
  ["StaticMaterialSwitchDef", "0x0e2212a1"],
  ["StaticMaterialTechniqueDef", "0x060a4413"],
  ["StaticMaterialPassDef", "0x8537d0c2"],
  ["SkinCharacterDataProperties", "0x9b67e9f6"],
  ["TftSkinCharacterDataProperties", "0x56767442"],
  ["VfxSystemDefinitionData", "0x45cd899f"],
  ["VfxEmitterDefinitionData", "0x09cde442"],
  ["AnimationGraphData", "0xf5fb07c7"],
  ["ValueColor", "0x074f91dd"],
  ["ValueFloat", "0x04300058"],
  ["ValueVector2", "0x69dc3449"],
  ["ValueVector3", "0x68dc32b6"],
  ["VfxAnimatedColorVariableData", "0x4349c5f5"],
  // The material layout's fields, and the fields its widgets read
  ["name", "0x8d39bde6"],
  ["type", "0x5127f14d"],
  ["samplerValues", "0x0a6f0eb5"],
  ["paramValues", "0xd0ab46b8"],
  ["switches", "0xdd7ddb9d"],
  ["shaderMacros", "0xe6d67ded"],
  ["techniques", "0x844f384e"],
  ["TextureName", "0xb311d4ef"],
  ["texturePath", "0xf0a363e3"],
  ["samplerName", "0x02e7fb4c"],
  ["addressU", "0x111ec6d2"],
  ["addressV", "0x101ec53f"],
  ["addressW", "0x0f1ec3ac"],
  ["filterMag", "0x4044d30e"],
  ["filterMin", "0x19310df1"],
  ["value", "0x425ed3ca"],
  ["on", "0x61342fd0"],
  ["passes", "0x623cd25c"],
  ["shader", "0x355d5568"],
  // The value family's fields
  ["constantValue", "0xb4b427aa"],
  ["dynamics", "0xbc037de7"],
  ["times", "0x5d68eeb5"],
  ["values", "0x34474c3b"],
];

describe("fnv1a32", () => {
  it("hashes the empty string to the offset basis", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
  });

  it("agrees with the game's hash on ltk_hash's own case", () => {
    expect(fnv1a32("test")).toBe(0xafd071e5);
  });

  it("reads a name without regard to case", () => {
    expect(fnv1a32("TEST")).toBe(fnv1a32("test"));
    expect(fnv1a32("SamplerValues")).toBe(fnv1a32("samplervalues"));
  });

  it("lowercases outside ASCII too", () => {
    expect(fnv1a32("É")).toBe(fnv1a32("é"));
  });
});

describe("nameHash", () => {
  it.each(KNOWN)("hashes %s to %s", (name, hash) => {
    expect(nameHash(name)).toBe(hash);
  });

  it("pads to the eight digits a row's path carries", () => {
    expect(nameHash("ValueColor")).toHaveLength(10);
  });
});
