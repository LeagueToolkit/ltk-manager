import { describe, expect, it } from "vitest";

import { compareDrawOrder, drawRanks } from "../drawKind";
import { BLEND_MODE, type BlendMode } from "../enums";
import type { EmitterModel } from "../model";

interface Order {
  index: number;
  pass?: number;
  blendMode?: BlendMode;
  miscRenderFlags?: number;
  groundLayer?: boolean;
}

function keyed({
  index,
  pass = 0,
  blendMode = BLEND_MODE.add,
  miscRenderFlags = 0,
  groundLayer = false,
}: Order) {
  return { index, pass, blendMode, miscRenderFlags, groundLayer } as EmitterModel;
}

describe("compareDrawOrder", () => {
  it("draws the ground layer's list before every other, whatever the pass says", () => {
    /* `AurelionSol_Skin11_E_ExecuteZone_ChildParticle`: `BG_BrighterInterior5` at 599
       under the rocks of `REFLECTION_SPHERE2` at 102. */
    const ground = keyed({ index: 22, pass: 599, groundLayer: true });
    const rock = keyed({ index: 27, pass: 102, blendMode: BLEND_MODE.alpha });

    expect(compareDrawOrder(ground, rock)).toBeLessThan(0);
    expect(compareDrawOrder(rock, ground)).toBeGreaterThan(0);
  });

  it("orders the ground layer's own emitters by pass, as it does every list", () => {
    const low = keyed({ index: 1, pass: -300, groundLayer: true });
    const high = keyed({ index: 0, pass: 10, groundLayer: true });

    expect(compareDrawOrder(low, high)).toBeLessThan(0);
  });

  it("draws a lower pass first, whatever the blend modes say", () => {
    const behind = keyed({ index: 0, pass: -10, blendMode: BLEND_MODE.targetAlpha });
    const ahead = keyed({ index: 1, pass: 10, blendMode: BLEND_MODE.none });

    expect(compareDrawOrder(behind, ahead)).toBeLessThan(0);
    expect(compareDrawOrder(ahead, behind)).toBeGreaterThan(0);
  });

  it("ranks the blend modes on a tied pass, NONE first and TARGETALPHA last", () => {
    const none = keyed({ index: 0, blendMode: BLEND_MODE.none });
    const add = keyed({ index: 1, blendMode: BLEND_MODE.add });
    const alpha = keyed({ index: 2, blendMode: BLEND_MODE.alpha });
    const target = keyed({ index: 3, blendMode: BLEND_MODE.targetAlpha });

    expect(compareDrawOrder(none, add)).toBeLessThan(0);
    expect(compareDrawOrder(add, alpha)).toBeLessThan(0);
    expect(compareDrawOrder(alpha, target)).toBeLessThan(0);
  });

  it("ties ADD with SUBTRACT and ALPHA with the other blended modes", () => {
    const add = keyed({ index: 0, blendMode: BLEND_MODE.add });
    const subtract = keyed({ index: 1, blendMode: BLEND_MODE.subtract });
    const alpha = keyed({ index: 2, blendMode: BLEND_MODE.alpha });
    const max = keyed({ index: 3, blendMode: BLEND_MODE.max });

    expect(compareDrawOrder(add, subtract)).toBeLessThan(0);
    expect(compareDrawOrder(subtract, add)).toBeGreaterThan(0);
    expect(compareDrawOrder(alpha, max)).toBeLessThan(0);
  });

  it("orders on the render flags byte below the blend rank, and on the index last", () => {
    const plain = keyed({ index: 5 });
    const flagged = keyed({ index: 4, miscRenderFlags: 1 });

    expect(compareDrawOrder(plain, flagged)).toBeLessThan(0);
    expect(compareDrawOrder(keyed({ index: 2 }), keyed({ index: 3 }))).toBeLessThan(0);
  });
});

describe("drawRanks", () => {
  it("ranks every emitter by its index in the order the comparator gives", () => {
    const ranks = drawRanks([
      keyed({ index: 0, pass: 100 }),
      keyed({ index: 1, pass: -1 }),
      keyed({ index: 2, pass: 1 }),
    ]);

    expect([...ranks.entries()].sort()).toEqual([
      [0, 2],
      [1, 0],
      [2, 1],
    ]);
  });

  it("keeps file order for emitters that tie on every key", () => {
    const ranks = drawRanks([keyed({ index: 3 }), keyed({ index: 1 }), keyed({ index: 2 })]);

    expect(ranks.get(1)).toBe(0);
    expect(ranks.get(2)).toBe(1);
    expect(ranks.get(3)).toBe(2);
  });

  it("answers nothing for no emitters", () => {
    expect(drawRanks([]).size).toBe(0);
  });
});
