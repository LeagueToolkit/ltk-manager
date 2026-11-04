import { BufferAttribute, BufferGeometry } from "three";
import { describe, expect, it } from "vitest";

import { createGeometryView } from "../backdropGeometry";

function source(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  geometry.addGroup(0, 3, 0);
  return geometry;
}

describe("createGeometryView", () => {
  it("draws the index and the attributes of the source under groups of its own", () => {
    const from = source();
    const view = createGeometryView(from);

    expect(view.index).toBe(from.index);
    expect(view.getAttribute("position")).toBe(from.getAttribute("position"));
    expect(view.groups).toEqual([]);
    expect(from.groups).toHaveLength(1);
  });

  it("names no shared buffer to the renderer when it is disposed", () => {
    const from = source();
    const view = createGeometryView(from);
    const named: unknown[] = [];
    view.addEventListener("dispose", ({ target }) => {
      named.push(target.index, ...Object.values(target.attributes));
    });

    view.dispose();

    expect(named).toEqual([null]);
    expect(view.index).toBe(from.index);
    expect(view.getAttribute("position")).toBe(from.getAttribute("position"));
  });
});
