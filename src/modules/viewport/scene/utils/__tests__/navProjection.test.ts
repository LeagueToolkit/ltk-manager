import { Texture } from "three";
import { describe, expect, it } from "vitest";

import type { MaterialPreview, RenderState } from "@/lib/tauri";

import { cellAt, type NavGrid } from "../../../assets/parsing/navGridBuffer";
import {
  bindProjectionMask,
  cellUvOf,
  createMaskedProjections,
  createNavProjectionUniforms,
  projectionCoverOf,
  projectionMaterialsOf,
  withinCutoff,
  writeCellSelection,
} from "../navProjection";

/** Returns the slots of an opaque material that writes depth, with `state` over its render state. */
function slots(state: Partial<RenderState> = {}): MaterialPreview {
  return {
    hash: "0x00000001",
    name: null,
    missing: false,
    animated: false,
    shader: null,
    base: null,
    tint: null,
    opacity: null,
    alphaTest: null,
    uvRepeat: null,
    uvScroll: null,
    renderState: {
      blending: "opaque",
      srcFactor: "one",
      dstFactor: "zero",
      premultiplied: false,
      cutout: false,
      doubleSided: false,
      inverted: false,
      depthWrite: true,
      depthTest: true,
      ...state,
    },
    warnings: [],
  };
}

/** Returns a grid of 3 x 2 cells, 50 units each, whose first corner is at `-100`, `20`. */
function grid(): NavGrid {
  return {
    xCells: 3,
    yCells: 2,
    cellSize: 50,
    min: [-100, 0, 20],
    max: [40, 0, 110],
    xSamples: 2,
    ySamples: 2,
    xSpacing: 140,
    ySpacing: 90,
    groupNames: new Uint32Array(8),
    tagNames: new Uint32Array(128),
    flags: new Uint16Array(6),
    regionTags: new Uint32Array(6),
    heights: new Float32Array(6),
    samples: new Float32Array(4),
  };
}

describe("cellUvOf", () => {
  it("maps the cell span from min to min plus count times cell size onto 0 to 1", () => {
    expect(cellUvOf(grid(), -100, 20)).toEqual([0, 0]);
    expect(cellUvOf(grid(), -25, 70)).toEqual([0.5, 0.5]);
  });

  it("puts world x, z in the texel of the cell that cellAt returns", () => {
    for (const [x, z] of [
      [-99, 21],
      [-50, 69.9],
      [-0.1, 70],
      [49.9, 119.9],
    ]) {
      const uv = cellUvOf(grid(), x, z);
      const cell = cellAt(grid(), x, z);

      expect(uv === null ? null : [Math.floor(uv[0] * 3), Math.floor(uv[1] * 2)]).toEqual(cell);
    }
  });

  it("returns null outside the cells, the far edges included", () => {
    expect(cellUvOf(grid(), -100.1, 50)).toBeNull();
    expect(cellUvOf(grid(), 50, 50)).toBeNull();
    expect(cellUvOf(grid(), 0, 120)).toBeNull();
  });
});

describe("withinCutoff", () => {
  it("tints a surface up to the cutoff above the navgrid and no higher", () => {
    expect(withinCutoff(160, 10, 150)).toBe(true);
    expect(withinCutoff(160.5, 10, 150)).toBe(false);
  });

  it("tints a surface below the navgrid at any depth", () => {
    expect(withinCutoff(-500, 10, 0)).toBe(true);
  });

  it("tints every surface if the cutoff is off or no height sample is under it", () => {
    expect(withinCutoff(5000, 10, null)).toBe(true);
    expect(withinCutoff(5000, null, 150)).toBe(true);
  });
});

/** Returns the slots of a blended cutout with a base texture, as Summoner's Rift's ground decals. */
function decal(state: Partial<RenderState> = {}): MaterialPreview {
  const blended = slots({ blending: "normal", premultiplied: true, cutout: true, ...state });
  return {
    ...blended,
    alphaTest: 0.3,
    base: {
      name: "DiffuseTexture",
      texture: { path: "order_mid_a_1bitalpha.tex", asset: null },
      rule: "exact",
      wrap: ["repeat", "repeat"],
    },
  };
}

describe("projectionCoverOf", () => {
  it("covers the whole of a surface that writes depth and discards nothing", () => {
    expect(projectionCoverOf(slots())).toEqual({ kind: "whole" });
    expect(projectionCoverOf(slots({ blending: "normal" }))).toEqual({ kind: "whole" });
    expect(projectionCoverOf(slots({ blending: "additive" }))).toEqual({ kind: "whole" });
  });

  it("covers the whole of a surface drawn without slots or with missing slots", () => {
    expect(projectionCoverOf(null)).toEqual({ kind: "whole" });
    expect(projectionCoverOf({ ...decal(), missing: true })).toEqual({ kind: "whole" });
  });

  it("masks a depth-writing alpha-tested surface by its base texel alpha at its threshold", () => {
    expect(projectionCoverOf(decal())).toEqual({ kind: "masked", alphaTest: 0.3 });
    expect(projectionCoverOf(decal({ blending: "opaque", cutout: false }))).toEqual({
      kind: "masked",
      alphaTest: 0.3,
    });
  });

  it("covers none of a surface without depth writes or an alpha-tested one without a base", () => {
    expect(projectionCoverOf(decal({ depthWrite: false }))).toEqual({ kind: "none" });
    expect(projectionCoverOf(slots({ blending: "normal", depthWrite: false }))).toEqual({
      kind: "none",
    });
    expect(projectionCoverOf({ ...decal(), base: null })).toEqual({ kind: "none" });
  });
});

describe("projectionMaterialsOf", () => {
  it("resolves each group's material index to the whole, the masked or the skipped entry", () => {
    const covers = [slots(), decal(), decal({ depthWrite: false }), null].map(projectionCoverOf);
    const groups = [3, 2, 1, 0].map((materialIndex) => ({ materialIndex }));
    const materials = projectionMaterialsOf(covers, "whole", new Map([[1, "masked"]]), "skipped");

    expect(materials).toHaveLength(covers.length);
    expect(groups.map(({ materialIndex }) => materials[materialIndex])).toEqual([
      "whole",
      "skipped",
      "masked",
      "whole",
    ]);
  });

  it("skips a masked cover that has no material", () => {
    expect(
      projectionMaterialsOf([projectionCoverOf(decal())], "whole", new Map(), "skipped"),
    ).toEqual(["skipped"]);
  });
});

describe("createMaskedProjections", () => {
  it("creates one hidden material per masked cover, keyed by the cover's index", () => {
    const covers = [slots(), decal(), null, decal()].map(projectionCoverOf);
    const masked = createMaskedProjections(covers, createNavProjectionUniforms());

    expect([...masked.materials.keys()]).toEqual([1, 3]);
    expect([...masked.materials.values()].map((material) => material.visible)).toEqual([
      false,
      false,
    ]);

    masked.dispose();
  });
});

describe("bindProjectionMask", () => {
  it("shows the material with its base texture and compiles it again on a gain or a loss", () => {
    const [material] = createMaskedProjections(
      [projectionCoverOf(decal())],
      createNavProjectionUniforms(),
    ).materials.values();
    if (material === undefined) throw new Error("no masked material");
    const preview = new Texture();
    const full = new Texture();

    const before = material.version;
    bindProjectionMask(material, preview);
    expect(material.map).toBe(preview);
    expect(material.visible).toBe(true);
    expect(material.version).toBe(before + 1);

    bindProjectionMask(material, full);
    expect(material.map).toBe(full);
    expect(material.version).toBe(before + 1);

    bindProjectionMask(material, null);
    expect(material.map).toBeNull();
    expect(material.visible).toBe(false);
    expect(material.version).toBe(before + 2);
  });
});

describe("writeCellSelection", () => {
  it("marks the selected cells and clears every other cell", () => {
    const into = Uint8Array.of(255, 255, 0, 0, 0, 0);

    writeCellSelection(
      [
        [2, 1],
        [7, 0],
      ],
      3,
      into,
    );

    expect([...into]).toEqual([0, 0, 0, 0, 0, 255]);
  });
});
