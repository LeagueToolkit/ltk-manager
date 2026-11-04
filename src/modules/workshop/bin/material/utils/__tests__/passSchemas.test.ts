import { describe, expect, it } from "vitest";

import type { ShaderSchema } from "@/lib/tauri";

import { mergedSchema } from "../passSchemas";

function schema(params: string[], textures: string[], switches: string[]): ShaderSchema {
  return {
    params: params.map((name) => ({
      name,
      physical: name,
      fields: 0b1111,
      default: [0, 0, 0, 0],
    })),
    textures: textures.map((name) => ({ name, default: null, sharedSampler: null })),
    switches: switches.map((name) => ({ name, onByDefault: false, runtime: false })),
  };
}

describe("mergedSchema", () => {
  it("declares every name any pass declares, in pass order", () => {
    const merged = mergedSchema([
      schema(["Tint", "Bloom"], ["Diffuse_Texture"], ["USE_RIM"]),
      null,
      schema(["SSScale"], ["ScreenSpaceTexture"], ["INVERT_SS_FRESNEL"]),
    ]);

    expect(merged?.params.map((param) => param.name)).toEqual(["Tint", "Bloom", "SSScale"]);
    expect(merged?.textures.map((texture) => texture.name)).toEqual([
      "Diffuse_Texture",
      "ScreenSpaceTexture",
    ]);
    expect(merged?.switches.map((each) => each.name)).toEqual(["USE_RIM", "INVERT_SS_FRESNEL"]);
  });

  it("keeps the first pass's row of a name two passes declare", () => {
    const first = schema(["Tint"], [], []);
    const second = schema(["Tint"], [], []);
    second.params[0] = { ...second.params[0]!, default: [1, 1, 1, 1] };

    expect(mergedSchema([first, second])?.params).toEqual(first.params);
  });

  it("returns null if no pass has a schema", () => {
    expect(mergedSchema([null, null])).toBeNull();
  });
});
