import { createContext, use, useEffect, useMemo } from "react";
import { Color, type ShaderMaterial } from "three";

import type { PreviewWireframe } from "@/stores";

import { wireMaterial } from "./materials";

/** How the run draws, and the colour its edges take. */
export interface Wireframe {
  readonly mode: PreviewWireframe;
  readonly colour: Color;
}

/** The draw order an edge twin takes past its solid, beyond every rank `drawRanks` hands out. */
export const WIRE_ORDER = 1_000_000;

/** How much of the shading an edge drawn over it covers, which leaves the particle readable. */
const OVERLAY_OPACITY = 0.35;

/** What the system's primitives draw their edges under, which a system outside the shell leaves off. */
export const WireframeContext = createContext<Wireframe>({ mode: "off", colour: new Color() });

/** The edge twin `solid` draws beside, and whether the solid itself still draws. */
export interface Wire {
  readonly material: ShaderMaterial | null;
  readonly shaded: boolean;
}

/** The edge twin the run's wireframe mode asks of any solid, and whether a solid still draws. */
export function useWireTwin(): {
  readonly twinOf: (solid: ShaderMaterial) => ShaderMaterial | null;
  readonly shaded: boolean;
} {
  const { mode, colour } = use(WireframeContext);
  const twinOf = useMemo(
    () => (solid: ShaderMaterial) => {
      if (mode === "off") return null;
      return wireMaterial(solid, colour, mode === "overlay" ? OVERLAY_OPACITY : 1);
    },
    [mode, colour],
  );
  return { twinOf, shaded: mode !== "only" };
}

/** The edge twin the run's wireframe mode asks of `solid`, "The viewer" in docs/ux/BIN_EDITOR.md. */
export function useWire(solid: ShaderMaterial): Wire {
  const { twinOf, shaded } = useWireTwin();
  const material = useMemo(() => twinOf(solid), [twinOf, solid]);
  useEffect(() => () => material?.dispose(), [material]);
  return { material, shaded };
}
