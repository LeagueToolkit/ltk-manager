import { describe, expect, it } from "vitest";

import type { ReflectionModel } from "../model";
import { fresnelLanes, reflectionLanes, reflectionTint } from "../reflection";

/** `VfxReflectionDefinitionData` at its schema defaults, with `over` on top. */
function reflection(over: Partial<ReflectionModel> = {}): ReflectionModel {
  return {
    fresnel: 1,
    fresnelColor: [0, 0, 0, 0],
    reflectionFresnel: 1,
    reflectionFresnelColor: [1, 1, 1, 1],
    opacityDirect: 0,
    opacityGlancing: 1,
    map: null,
    ...over,
  };
}

describe("fresnelLanes", () => {
  it("puts fresnelColor's three channels before the exponent and reads no alpha", () => {
    /* The commonest written rim on an attached mesh, which draws red however its alpha reads. */
    expect(fresnelLanes(reflection({ fresnel: 0.1, fresnelColor: [1, 0, 0, 0] }))).toEqual([
      1, 0, 0, 0.1,
    ]);
    expect(fresnelLanes(reflection({ fresnel: 0.07, fresnelColor: [0.3, 0.3, 0.3, 5] }))).toEqual([
      0.3, 0.3, 0.3, 0.07,
    ]);
  });

  it("adds no rim for a mesh without the block, or with the block at its defaults", () => {
    expect(fresnelLanes(null).slice(0, 3)).toEqual([0, 0, 0]);
    expect(fresnelLanes(reflection()).slice(0, 3)).toEqual([0, 0, 0]);
  });
});

describe("reflectionLanes", () => {
  it("carries the exponent, then the opacity facing the eye and the opacity edge on", () => {
    const lanes = reflectionLanes(
      reflection({ reflectionFresnel: 0.6, opacityDirect: 0.3, opacityGlancing: 0.2 }),
    );

    expect(lanes).toEqual([0.6, 0.3, 0.2, 0]);
  });

  it("takes the schema's defaults for a mesh without the block", () => {
    expect(reflectionLanes(null)).toEqual([1, 0, 1, 0]);
  });
});

describe("reflectionTint", () => {
  it("is reflectionFresnelColor's three channels, and white without the block", () => {
    expect(reflectionTint(reflection({ reflectionFresnelColor: [0.5, 0.25, 1, 0] }))).toEqual([
      0.5, 0.25, 1,
    ]);
    expect(reflectionTint(null)).toEqual([1, 1, 1]);
  });
});
