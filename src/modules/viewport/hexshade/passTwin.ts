import { Matrix4, Mesh, SkinnedMesh } from "three";

/**
 * A mesh over the geometry of `of` that draws one later pass of its programs.
 *
 * The twin is added as a child of `of` with no transform of its own, and shares its skeleton
 * and its `onBeforeRender`, so the engine environment writes the same transform for both.
 * `layer` raises its `renderOrder`, so the twin draws after `of`, as the engine draws a
 * material's passes in order. It draws nothing until a material is set.
 */
export function passTwin(of: Mesh, layer: number): Mesh {
  const twin =
    of instanceof SkinnedMesh ? new SkinnedMesh(of.geometry, []) : new Mesh(of.geometry, []);
  twin.frustumCulled = false;
  twin.renderOrder = of.renderOrder + layer;
  twin.onBeforeRender = of.onBeforeRender;

  if (twin instanceof SkinnedMesh && of instanceof SkinnedMesh) {
    twin.bind(of.skeleton, new Matrix4());
  }
  return twin;
}

/** Twins of `of` for each pass after the first, where the deepest program has `passes`. */
export function passTwins(of: Mesh, passes: number): Mesh[] {
  return Array.from({ length: Math.max(passes - 1, 0) }, (_, at) => passTwin(of, at + 1));
}
