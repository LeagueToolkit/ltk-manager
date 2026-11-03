import { Color, DoubleSide, SRGBColorSpace, Texture } from "three";
import { describe, expect, it } from "vitest";

import type { OutlineMaterial } from "@/lib/tauri";

import { whiteTexel } from "../../../hexshade/neutralTextures";
import {
  applyOutline,
  createOutlineMaterial,
  OutlineMaterials,
  type OutlineUniforms,
  type SubmeshOutline,
} from "../outlineMaterial";

/** `Jade_CharacterOutline_Default_inst`, as the shipped material sets it. */
const JADE: OutlineMaterial = {
  hash: "0xaaec01e5",
  name: null,
  color: [0, 0, 0, 1],
  width: 5,
  cameraDistance: 4500,
  depthOffset: -20,
  alpha: 1,
  mask: null,
  maskChannels: [1, 0, 0, 0],
};

function uniforms(outline: OutlineMaterial, mask: Texture | null = null): OutlineUniforms {
  const material = createOutlineMaterial();
  applyOutline(material, outline, mask);
  return material.uniforms as unknown as OutlineUniforms;
}

function stock(material: OutlineMaterial): SubmeshOutline {
  return { material, mask: null, program: null };
}

describe("createOutlineMaterial", () => {
  it("draws both faces, blended, with depth writes", () => {
    const material = createOutlineMaterial();

    expect(material.side).toBe(DoubleSide);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.vertexShader).toContain("#include <skinning_vertex>");
  });
});

describe("applyOutline", () => {
  it("writes each parameter of the material into its uniform", () => {
    const mask = new Texture();
    const written = uniforms(
      { ...JADE, color: [0.02, 0.09, 0.05, 1], maskChannels: [0, 1, 0, 0] },
      mask,
    );

    const green = new Color().setRGB(0.02, 0.09, 0.05, SRGBColorSpace);
    expect(written.outlineColor.value.equals(green)).toBe(true);
    expect(written.outlineWidth.value).toBe(5);
    expect(written.cameraDistance.value).toBe(4500);
    expect(written.depthOffset.value).toBe(-20);
    expect(written.alpha.value).toBe(1);
    expect(written.mask.value).toBe(mask);
    expect(written.maskChannels.value).toEqual([0, 1, 0, 0]);
  });

  it("falls back to the shader's defaults and a white mask if a value is missing", () => {
    const written = uniforms({
      ...JADE,
      width: null,
      cameraDistance: null,
      depthOffset: null,
      alpha: null,
    });

    expect(written.outlineWidth.value).toBe(0.25);
    expect(written.cameraDistance.value).toBe(600);
    expect(written.depthOffset.value).toBe(20);
    expect(written.alpha.value).toBe(1);
    expect(written.mask.value).toBe(whiteTexel());
  });
});

describe("OutlineMaterials", () => {
  it("returns one material per outline material and writes the latest values", () => {
    const outlines = new OutlineMaterials();

    const first = outlines.acquire(stock(JADE));
    const again = outlines.acquire(stock({ ...JADE, width: 2 }));
    const other = outlines.acquire(stock({ ...JADE, hash: "0x120314ea" }));

    expect(again).toBe(first);
    expect(other).not.toBe(first);
    expect((first.uniforms as unknown as OutlineUniforms).outlineWidth.value).toBe(2);
  });

  it("disposes the materials that retain is not given", () => {
    const outlines = new OutlineMaterials();
    const kept = outlines.acquire(stock(JADE));
    const dropped = outlines.acquire(stock({ ...JADE, hash: "0x120314ea" }));
    let disposed = false;
    dropped.addEventListener("dispose", () => {
      disposed = true;
    });

    outlines.retain(new Set([kept]));

    expect(disposed).toBe(true);
    expect(outlines.acquire(stock(JADE))).toBe(kept);
  });
});
