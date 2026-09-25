import { InstancedMesh, Matrix4, Mesh, SkinnedMesh } from "three";

/**
 * A mesh over the geometry of `of` that draws one later pass of its programs.
 *
 * The twin is added as a child of `of` with no transform of its own, and shares its skeleton,
 * its bind mode and its `onBeforeRender`, so the engine environment writes the same transform
 * for both. An instanced twin shares the instance matrices, and its `count` is the caller's to
 * keep. `layer` raises its `renderOrder`, so the twin draws after `of`, as the engine draws a
 * material's passes in order. It draws nothing until a material is set.
 */
export function passTwin(of: Mesh, layer: number): Mesh {
  const twin = twinOf(of);
  twin.frustumCulled = false;
  twin.renderOrder = of.renderOrder + layer;
  twin.onBeforeRender = of.onBeforeRender;
  return twin;
}

function twinOf(of: Mesh): Mesh {
  if (of instanceof SkinnedMesh) {
    const twin = new SkinnedMesh(of.geometry, []);
    twin.bindMode = of.bindMode;
    twin.bind(of.skeleton, new Matrix4());
    return twin;
  }

  if (of instanceof InstancedMesh) {
    const twin = new InstancedMesh(of.geometry, [], of.count);
    twin.instanceMatrix = of.instanceMatrix;
    return twin;
  }

  return new Mesh(of.geometry, []);
}

/** Twins of `of` for each pass after the first, where the deepest program has `passes`. */
export function passTwins(of: Mesh, passes: number): Mesh[] {
  return Array.from({ length: Math.max(passes - 1, 0) }, (_, at) => passTwin(of, at + 1));
}
