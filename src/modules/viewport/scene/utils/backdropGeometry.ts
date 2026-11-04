import { BufferAttribute, BufferGeometry } from "three";

import type { MapGeometry } from "../../assets/parsing/mapBuffer";

/** Each input a translated vertex shader declares, and the stock attribute it is. */
const PROGRAM_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["a_POSITION", "position"],
  ["a_NORMAL", "normal"],
  ["a_TEXCOORD", "uv"],
  ["a_TEXCOORD7", "uv1"],
];

/** Returns the whole of `map` as one geometry, its groups written by whichever backdrop draws it. */
export function createMapGeometry(map: MapGeometry): BufferGeometry {
  const held = new BufferGeometry();
  held.setAttribute("position", new BufferAttribute(map.positions, 3));
  held.setAttribute("normal", new BufferAttribute(map.normals, 3));
  held.setAttribute("uv", new BufferAttribute(map.uv0, 2));
  if (map.uv1 !== null) held.setAttribute("uv1", new BufferAttribute(map.uv1, 2));
  held.setIndex(new BufferAttribute(map.indices, 1));
  for (const [name, of] of PROGRAM_ATTRIBUTES) {
    const attribute = held.getAttribute(of);
    if (attribute !== undefined) held.setAttribute(name, attribute);
  }
  /* Over 2.04 million vertices, so it is computed with the geometry and never again. */
  held.computeBoundingSphere();
  return held;
}

/**
 * A geometry over the index and the attributes of another, with draw groups of its own.
 *
 * `dispose` frees nothing that the source holds. Three deletes the buffers of the index and of
 * every attribute that a disposed geometry names, which would upload the source again.
 */
class GeometryView extends BufferGeometry {
  override dispose(): void {
    const { index, attributes } = this;
    this.index = null;
    this.attributes = {};

    super.dispose();

    this.index = index;
    this.attributes = attributes;
  }
}

/** Returns a geometry that draws the index and the attributes of `source` under groups of its own. */
export function createGeometryView(source: BufferGeometry): BufferGeometry {
  const view = new GeometryView();
  view.setIndex(source.index);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    view.setAttribute(name, attribute);
  }
  return view;
}
