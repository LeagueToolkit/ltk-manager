import { useEffect, useMemo } from "react";
import type { DataTexture } from "three";

import {
  type ConformanceGround,
  type ConformanceUniforms,
  createConformanceUniforms,
  writeConformanceUniforms,
} from "../utils/conformanceSurface";

/**
 * Returns the uniforms that every `conformance` material of one backdrop shares, written from
 * `ground` and its `heights` texture.
 *
 * The uniforms keep their identity, so a new threshold or grid rebuilds no material.
 */
export function useConformanceUniforms(
  ground: ConformanceGround | null,
  heights: DataTexture | null,
): ConformanceUniforms {
  const uniforms = useMemo(createConformanceUniforms, []);

  useEffect(() => {
    writeConformanceUniforms(uniforms, ground, heights);
  }, [uniforms, ground, heights]);

  return uniforms;
}
