import { describe, expect, it } from "vitest";

import {
  BLEND_MODE,
  type BlendMode,
  QUAD_TYPE,
  type QuadType,
  UV_MODE,
  type UvMode,
} from "../enums";
import type { EmitterModel, SoftModel } from "../model";
import { fadeOf, softControl, softParams } from "../softParticle";

/**
 * The fade `quad_ps` and `mesh_ps` run off `cSoftParticleParams`, at a gap between the
 * scene's depth and the fragment's, as the engine computes it.
 */
function fadeAt(gap: number, [x, y, z, w]: readonly number[]): number {
  const eased = (t: number) => {
    const held = Math.min(Math.max(t, 0), 1);
    return held * held * (3 - 2 * held);
  };
  return eased((gap - x) * z) - eased((gap - y) * w);
}

function soft(over: Partial<SoftModel> = {}): SoftModel {
  return { beginIn: 0, deltaIn: 0, beginOut: 0, deltaOut: 0, ...over };
}

describe("softParams", () => {
  it("fades Ahri_Base_R_mis_02's cone in over ten units past a gap of twenty", () => {
    const params = softParams(soft({ beginIn: 20, deltaIn: 10 }));

    expect(fadeAt(15, params)).toBe(0);
    expect(fadeAt(25, params)).toBeCloseTo(0.5);
    expect(fadeAt(30, params)).toBe(1);
    expect(fadeAt(500, params)).toBe(1);
  });

  it("fades out beginOut past the end of the fade in, over deltaOut", () => {
    /* `AurelionSol_Skin11_E_ExecuteZone_ChildParticle`'s `REFLECTION_SPHERE4`. */
    const params = softParams(soft({ deltaIn: 75, beginOut: 60, deltaOut: 60 }));

    expect(fadeAt(0, params)).toBe(0);
    expect(fadeAt(75, params)).toBe(1);
    expect(fadeAt(135, params)).toBe(1);
    expect(fadeAt(165, params)).toBeCloseTo(0.5);
    expect(fadeAt(195, params)).toBe(0);
  });

  it("draws a band where the fade out follows the fade in at once", () => {
    /* `Akali_Base_E_Enemy_Indicator_Red`'s `Light_right`, `0, 10, 0, 10`, and 1,648 like it. */
    const params = softParams(soft({ deltaIn: 10, deltaOut: 10 }));

    expect(fadeAt(0, params)).toBe(0);
    expect(fadeAt(10, params)).toBe(1);
    expect(fadeAt(20, params)).toBe(0);
    for (const gap of [2, 5, 15, 18]) expect(fadeAt(gap, params)).toBeGreaterThan(0);
  });

  it("draws a side of no width as no fade on that side, whatever its begin", () => {
    /* `Brand_Skin08_Z_Recall_DrangonPowerDown`'s `Dragonup4`, `100, 0, 100, 0`. */
    const params = softParams(soft({ beginIn: 100, beginOut: 100 }));

    for (const gap of [-50, 0, 50, 150, 5000]) expect(fadeAt(gap, params)).toBe(1);
  });

  it("keeps the fade in alone where only deltaOut is zero", () => {
    const params = softParams(soft({ deltaIn: 30 }));

    expect(fadeAt(0, params)).toBe(0);
    expect(fadeAt(30, params)).toBe(1);
    expect(fadeAt(10_000, params)).toBe(1);
  });
});

describe("softControl", () => {
  /** What a fade of `fade` leaves of a colour and an alpha of one. */
  function drawn(mode: BlendMode, fade: number): [number, number] {
    const [x, y, z, w] = softControl(mode);
    return [x + fade * y, z + fade * w];
  }

  it("fades the alpha under the two modes that weigh the colour by it", () => {
    expect(drawn(BLEND_MODE.alpha, 0.25)).toEqual([1, 0.25]);
    expect(drawn(BLEND_MODE.alphaAdd, 0.25)).toEqual([1, 0.25]);
  });

  it("fades both under premultiplied alpha, whose colour already carries it", () => {
    expect(drawn(BLEND_MODE.premultipliedAlpha, 0.25)).toEqual([0.25, 0.25]);
  });

  it("fades the colour under every mode that takes it whole", () => {
    for (const mode of [
      BLEND_MODE.add,
      BLEND_MODE.subtract,
      BLEND_MODE.none,
      BLEND_MODE.min,
      BLEND_MODE.max,
      BLEND_MODE.targetAlpha,
    ]) {
      expect(drawn(mode, 0.25)).toEqual([0.25, 1]);
    }
  });
});

describe("fadeOf", () => {
  const faded = soft({ deltaIn: 30 });
  const of = (quadType: QuadType, uvMode: UvMode = UV_MODE.default) =>
    fadeOf({ soft: faded, quadType, uvMode } as EmitterModel);

  it("fades a quad, a ray, a mesh and a ribbon", () => {
    for (const kind of [
      QUAD_TYPE.cameraQuad,
      QUAD_TYPE.arbitraryQuad,
      QUAD_TYPE.ray,
      QUAD_TYPE.mesh,
      QUAD_TYPE.cameraTrail,
      QUAD_TYPE.arbitraryTrail,
      QUAD_TYPE.beam,
    ]) {
      expect(of(kind)).toBe(faded);
    }
  });

  it("fades no attached mesh, whose skinned shader compiles no soft fade", () => {
    expect(of(QUAD_TYPE.attachedMesh)).toBeNull();
  });

  it("fades no quad or ribbon under LOCK_ALPHA and still fades a mesh under it", () => {
    for (const kind of [
      QUAD_TYPE.cameraQuad,
      QUAD_TYPE.arbitraryQuad,
      QUAD_TYPE.ray,
      QUAD_TYPE.cameraTrail,
      QUAD_TYPE.arbitraryTrail,
      QUAD_TYPE.beam,
    ]) {
      expect(of(kind, UV_MODE.lockAlpha)).toBeNull();
    }
    expect(of(QUAD_TYPE.mesh, UV_MODE.lockAlpha)).toBe(faded);
  });

  it("fades nothing for an emitter without the block", () => {
    expect(fadeOf({ soft: null, quadType: QUAD_TYPE.mesh } as EmitterModel)).toBeNull();
  });
});
