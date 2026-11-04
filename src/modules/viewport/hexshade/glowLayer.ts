import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type { Scene } from "three";

/** The layer a pass's glow copy draws on, which only the glow pass sees. */
export const GLOW_LAYER = 3;

const GLOWING = new WeakMap<Scene, number>();

/** Counts the scene as holding a glow copy while `glows`, which turns its glow pass on. */
export function useGlowing(glows: boolean): void {
  const scene = useThree((state) => state.scene);
  useEffect(() => {
    if (!glows) return;

    GLOWING.set(scene, (GLOWING.get(scene) ?? 0) + 1);
    return () => {
      GLOWING.set(scene, (GLOWING.get(scene) ?? 1) - 1);
    };
  }, [glows, scene]);
}

/** Returns whether `scene` holds a glow copy the frame draws a glow pass for. */
export function glowing(scene: Scene): boolean {
  return (GLOWING.get(scene) ?? 0) > 0;
}
