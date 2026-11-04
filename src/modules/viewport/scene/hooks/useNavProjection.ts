import { useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import type { DataTexture, MeshBasicMaterial, Texture } from "three";

import { useDisposable } from "@/hooks";

import { writeCellColors } from "../../assets/parsing/navGridColors";
import {
  bindProjectionMask,
  createCellColorTexture,
  createCellSelectionTexture,
  createMaskedProjections,
  createNavProjectionMaterial,
  createNavProjectionUniforms,
  NAV_PROJECTION_ALPHA,
  type NavProjection,
  type ProjectedSurface,
  projectionCoverOf,
  projectionMaterialsOf,
  SKIPPED_PROJECTION,
  writeCellSelection,
  writeNavProjectionUniforms,
} from "../utils/navProjection";

/**
 * Returns the material array of one backdrop's navgrid projection, one entry per entry of
 * `surfaces`, or null without a projection.
 *
 * The materials and their uniforms keep their identity while a projection is set. A masked
 * surface takes a material of its own, which reads the surface's base texture from `textures` by
 * path and draws nothing until that texture loads. A change of overlays, colors or color mode
 * writes the cell color texture, a change of selection writes the selection texture, and a
 * cutoff or highlight change writes uniforms alone. Each write requests a frame. The textures
 * and the materials are disposed when the cell count changes, the projection goes, or the caller
 * unmounts.
 */
export function useNavProjection(
  projection: NavProjection | null,
  heights: DataTexture | null,
  surfaces: readonly ProjectedSurface[],
  textures: ReadonlyMap<string, Texture>,
): MeshBasicMaterial[] | null {
  const invalidate = useThree((state) => state.invalidate);
  const uniforms = useMemo(createNavProjectionUniforms, []);

  const shown = projection !== null;
  const xCells = projection?.grid.xCells ?? 0;
  const yCells = projection?.grid.yCells ?? 0;
  const cells = useDisposable(
    () => (shown ? createCellColorTexture(xCells, yCells) : null),
    [shown, xCells, yCells],
  );
  const selection = useDisposable(
    () => (shown ? createCellSelectionTexture(xCells, yCells) : null),
    [shown, xCells, yCells],
  );
  const material = useDisposable(
    () => (shown ? createNavProjectionMaterial(uniforms) : null),
    [shown, uniforms],
  );
  const covers = useMemo(() => surfaces.map(({ slots }) => projectionCoverOf(slots)), [surfaces]);
  const masked = useDisposable(
    () => (shown ? createMaskedProjections(covers, uniforms) : null),
    [shown, covers, uniforms],
  );

  const grid = projection?.grid ?? null;
  const config = projection?.config ?? null;
  const mode = projection?.mode ?? null;
  useEffect(() => {
    if (cells === null || grid === null || config === null || mode === null) return;

    writeCellColors(grid, config, mode, NAV_PROJECTION_ALPHA, cells.image.data as Uint8Array);
    cells.needsUpdate = true;
    invalidate();
  }, [cells, grid, config, mode, invalidate]);

  const selected = projection?.selected ?? null;
  useEffect(() => {
    if (selection === null || selected === null) return;

    writeCellSelection(selected, xCells, selection.image.data as Uint8Array);
    selection.needsUpdate = true;
    invalidate();
  }, [selection, selected, xCells, invalidate]);

  useEffect(() => {
    if (projection === null || cells === null || selection === null) return;

    writeNavProjectionUniforms(uniforms, projection, { cells, selected: selection, heights });
    invalidate();
  }, [uniforms, projection, cells, selection, heights, invalidate]);

  useEffect(() => {
    if (masked === null) return;

    for (const [at, each] of masked.materials) {
      const path = surfaces[at]?.path;
      bindProjectionMask(each, path === undefined ? null : (textures.get(path) ?? null));
    }
    invalidate();
  }, [masked, surfaces, textures, invalidate]);

  return useMemo(
    () =>
      material === null || masked === null
        ? null
        : projectionMaterialsOf(covers, material, masked.materials, SKIPPED_PROJECTION),
    [material, masked, covers],
  );
}
