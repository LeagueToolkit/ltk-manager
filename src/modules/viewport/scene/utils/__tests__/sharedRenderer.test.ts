import { Material, Object3D, type RenderItem } from "three";
import { describe, expect, it } from "vitest";

import {
  KEEPS_GROUP_ORDER,
  opaqueOrder,
  type OrderedGroup,
  transparentOrder,
} from "../sharedRenderer";

function object(flagged = false): Object3D {
  const made = new Object3D();
  if (flagged) made.userData[KEEPS_GROUP_ORDER] = true;
  return made;
}

/** One draw of `of` with `material`, named so a sorted list reads as its names. */
function item(
  name: string,
  of: Object3D,
  material: Material,
  over: { renderOrder?: number; z?: number; order?: number; tier?: number } = {},
): RenderItem & { name: string } {
  const group: OrderedGroup | null =
    over.order === undefined
      ? null
      : { start: 0, count: 3, materialIndex: 0, order: over.order, tier: over.tier };
  return {
    name,
    id: of.id,
    object: of,
    geometry: null,
    material,
    materialVariant: 0,
    groupOrder: 0,
    renderOrder: over.renderOrder ?? 0,
    z: over.z ?? 0,
    group: group as RenderItem["group"],
  };
}

const names = (items: readonly { name: string }[]) => items.map((each) => each.name);

describe("opaqueOrder", () => {
  /* Created in this order, so `first` has the lower material id. */
  const first = new Material();
  const second = new Material();

  it("orders the draws of unflagged objects by material, then by depth", () => {
    const one = object();
    const other = object();
    const items = [
      item("second far", one, second, { z: 9 }),
      item("first", other, first, { z: 5 }),
      item("second near", other, second, { z: 1 }),
    ];

    expect(names(items.sort(opaqueOrder))).toEqual(["first", "second near", "second far"]);
  });

  it("keeps the given order of the groups of a flagged object, whatever their materials", () => {
    const backdrop = object(true);
    const items = [
      item("near", backdrop, second),
      item("middle", backdrop, first),
      item("far", backdrop, second),
    ];

    expect(names(items.sort(opaqueOrder))).toEqual(["near", "middle", "far"]);
  });

  it("orders a flagged object ahead of the unflagged objects of its render order", () => {
    const backdrop = object(true);
    const other = object();
    const items = [
      item("other", other, first),
      item("near", backdrop, second),
      item("far", backdrop, first),
    ];

    expect(names(items.sort(opaqueOrder))).toEqual(["near", "far", "other"]);
  });

  it("orders by render order before the flag", () => {
    const backdrop = object(true);
    const other = object();
    const items = [
      item("backdrop", backdrop, first, { renderOrder: 1 }),
      item("other", other, second, { renderOrder: 0 }),
    ];

    expect(names(items.sort(opaqueOrder))).toEqual(["other", "backdrop"]);
  });
});

describe("transparentOrder", () => {
  const material = new Material();

  it("orders the draws of different objects farthest first", () => {
    const items = [
      item("near", object(), material, { z: 1 }),
      item("far", object(), material, { z: 9 }),
    ];

    expect(names(items.sort(transparentOrder))).toEqual(["far", "near"]);
  });

  it("orders the groups of a flagged object last listed first", () => {
    const backdrop = object(true);
    const items = [
      item("near", backdrop, material, { order: 0 }),
      item("middle", backdrop, material, { order: 1 }),
      item("far", backdrop, material, { order: 2 }),
    ];

    expect(names(items.sort(transparentOrder))).toEqual(["far", "middle", "near"]);
  });

  it("orders the groups of a flagged object by tier, then last listed first", () => {
    const backdrop = object(true);
    const items = [
      item("near decal", backdrop, material, { order: 0, tier: 1 }),
      item("near water", backdrop, material, { order: 1, tier: 2 }),
      item("near ground", backdrop, material, { order: 2, tier: 0 }),
      item("far decal", backdrop, material, { order: 3, tier: 1 }),
      item("far ground", backdrop, material, { order: 4, tier: 0 }),
    ];

    expect(names(items.sort(transparentOrder))).toEqual([
      "far ground",
      "near ground",
      "far decal",
      "near decal",
      "near water",
    ]);
  });

  it("ignores the tier of the groups of an unflagged object", () => {
    const plain = object();
    const items = [
      item("a", plain, material, { order: 0, tier: 2 }),
      item("b", plain, material, { order: 1, tier: 0 }),
    ];

    expect(names(items.sort(transparentOrder))).toEqual(["a", "b"]);
  });

  it("keeps the given order of the groups of an unflagged object", () => {
    const plain = object();
    const items = [
      item("a", plain, material, { order: 0 }),
      item("b", plain, material, { order: 1 }),
    ];

    expect(names(items.sort(transparentOrder))).toEqual(["a", "b"]);
  });
});
