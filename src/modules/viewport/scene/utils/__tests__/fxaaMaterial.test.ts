import { Texture, Vector2, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { FXAA_QUALITY_OPTIONS } from "../antiAliasing";
import { fxaaMaterial, writeFxaa } from "../fxaaMaterial";

describe("fxaaMaterial", () => {
  it("carries the game's quality options as subpix, edge threshold and floor", () => {
    const material = fxaaMaterial(new Texture());

    expect(material.uniforms.options.value).toEqual(
      new Vector3(
        FXAA_QUALITY_OPTIONS.subpix,
        FXAA_QUALITY_OPTIONS.edgeThreshold,
        FXAA_QUALITY_OPTIONS.edgeThresholdMin,
      ),
    );
  });

  it("searches an edge in the eleven steps of preset 26", () => {
    const material = fxaaMaterial(new Texture());

    expect(material.fragmentShader).toContain("#define STEPS 11");
    expect(material.fragmentShader).toContain(
      "float[](1.0, 1.5, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 4.0, 8.0)",
    );
  });

  it("writes the reciprocal of the frame's size", () => {
    const material = fxaaMaterial(new Texture());

    writeFxaa(material, new Vector2(1920, 1080));

    expect(material.uniforms.rcpFrame.value).toEqual(new Vector2(1 / 1920, 1 / 1080));
  });
});
