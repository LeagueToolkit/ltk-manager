import { type RefObject, useEffect, useMemo, useRef } from "react";
import type { BufferGeometry, RawShaderMaterial } from "three";

import type { BinDocumentId } from "@/lib/tauri";
import {
  createProgramMaterial,
  EngineEnvironment,
  engineColors,
  glowMaterial,
} from "@/modules/viewport";
import { usePreviewShaders } from "@/stores";

import type { ShimmerMesh } from "../utils/shimmerMeshes";
import { useEmbeddedMaterialPasses, useMaterialPasses } from "./useParticlePrograms";

/** Each pass of an embedded material, and the environment, clock and tint its draws write. */
export interface PassMaterials {
  readonly materials: readonly RawShaderMaterial[];
  /** Each pass's glow copy, by the pass's index, and null for a pass with one target. */
  readonly glows: readonly (RawShaderMaterial | null)[];
  readonly environment: EngineEnvironment;
  /** Seconds into the run, which the caller sets before the frame draws. */
  readonly time: RefObject<number>;
  /** The particle's colour, which the caller writes in place every frame. */
  readonly color: [number, number, number, number];
}

const NO_MATERIALS: readonly RawShaderMaterial[] = [];
const NO_GLOWS: readonly (RawShaderMaterial | null)[] = [];

/**
 * The translated passes of the material `mesh` embeds or links to, none while the game's
 * shaders are off or a pass is not ready, under one environment the particle's colour tints.
 *
 * Array uniforms rather than groups: a map stands many meshes, and the context's 24 binding
 * points are shared with the backdrop's draws. `BufferBinding` has the detail.
 */
export function useShimmerPasses(
  document: BinDocumentId,
  mesh: ShimmerMesh,
  geometry: BufferGeometry | null,
): PassMaterials {
  const shaders = usePreviewShaders();
  const embedded = useEmbeddedMaterialPasses(document, shaders ? mesh.material : null);
  const linked = useMaterialPasses(
    document,
    shaders && mesh.material === null ? (mesh.linked?.hash ?? null) : null,
  );
  const passes = mesh.material === null ? linked.passes : embedded.passes;
  const time = useRef(0);
  const [environment, color] = useMemo(() => {
    const made = new EngineEnvironment("uniform");
    const tint: [number, number, number, number] = [1, 1, 1, 1];
    made.particle = { colorFactor: tint, depthPushPull: 0 };
    return [made, tint] as const;
  }, []);
  useEffect(() => () => environment.dispose(), [environment]);

  const { materials, glows } = useMemo(() => {
    if (geometry === null || passes.length === 0) {
      return { materials: NO_MATERIALS, glows: NO_GLOWS };
    }

    nameForPrograms(geometry);
    const made = passes.map((pass) => createProgramMaterial(pass, environment));
    return { materials: made, glows: made.map(glowMaterial) };
  }, [geometry, passes, environment]);
  useEffect(
    () => () => {
      for (const material of [...materials, ...glows]) material?.dispose();
    },
    [materials, glows],
  );

  return { materials, glows, environment, time, color };
}

/** Each input a translated vertex stage declares, and the stock attribute it is. */
const PROGRAM_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["a_POSITION", "position"],
  ["a_NORMAL", "normal"],
  ["a_TEXCOORD", "uv"],
];

function nameForPrograms(geometry: BufferGeometry): void {
  for (const [name, of] of PROGRAM_ATTRIBUTES) {
    const attribute = geometry.getAttribute(of);
    if (attribute !== undefined) geometry.setAttribute(name, attribute);
  }

  const colors = geometry.getAttribute("vertexColor");
  if (colors !== undefined) geometry.setAttribute("a_COLOR", engineColors(colors.array));
}
