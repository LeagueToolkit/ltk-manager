import type { DataTexture } from "three";

import { useDisposable } from "@/hooks";

import type { NavGrid } from "../../assets/parsing/navGridBuffer";
import { createHeightTexture } from "../utils/conformanceSurface";

/**
 * Returns the `R32F` texture of the height samples of `grid`, or null without a grid.
 *
 * The conformance surface and the navgrid projection of one backdrop share it, so the samples
 * upload once. The texture is keyed on the samples, which overlays never change, and is disposed
 * when they change or the caller unmounts.
 */
export function useNavHeights(grid: NavGrid | null): DataTexture | null {
  const samples = grid?.samples ?? null;
  const xSamples = grid?.xSamples ?? 0;
  const ySamples = grid?.ySamples ?? 0;

  return useDisposable(
    () => (samples === null ? null : createHeightTexture(samples, xSamples, ySamples)),
    [samples, xSamples, ySamples],
  );
}
