import type { SystemModel } from "../../engine/model/model";
import { drawnEmitters } from "./definitions";
import { distorts } from "./drawKind";
import { fades } from "./softParticle";

/** The frame passes a scene's emitters need, which `Passes` runs. */
export interface ScenePasses {
  /** An emitter warps the frame, so the frame is copied before the distortion layer draws. */
  readonly warps: boolean;
  /** An emitter fades on depth, so the scene's depth is drawn before the particles. */
  readonly softens: boolean;
}

/** The passes `systems` need, over their emitters and every child set's. */
export function passesOf(systems: readonly (SystemModel | null | undefined)[]): ScenePasses {
  let warps = false;
  let softens = false;

  for (const system of systems) {
    if (system == null) continue;

    for (const { emitter } of drawnEmitters(system, true)) {
      warps ||= distorts(emitter);
      softens ||= fades(emitter);
      if (warps && softens) return { warps, softens };
    }
  }
  return { warps, softens };
}
