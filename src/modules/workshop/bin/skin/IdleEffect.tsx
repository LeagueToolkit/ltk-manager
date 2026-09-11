import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

import type { IdleEffect as IdleEffectModel } from "@/lib/tauri";
import type { Pose, SceneClock } from "@/modules/viewport";

import { drawnEmitters } from "../vfx/definitions";
import { createDriver } from "../vfx/driver";
import type { SystemModel } from "../vfx/model";
import { useVfxMeshes } from "../vfx/useVfxMeshes";
import { useVfxTextures } from "../vfx/useVfxTextures";
import { VfxSystem } from "../vfx/VfxSystem";
import { followClock, following } from "./follow";
import { idleRig } from "./skinScene";

/** The seed every idle effect runs on, so two readers of one skin see the same run. */
const IDLE_SEED = 1337;

export interface IdleEffectProps {
  readonly effect: IdleEffectModel;
  readonly system: SystemModel;
  readonly pose: Pose;
  readonly clock: SceneClock;
  /** `skinScale`, which carries the joint the effect rides. */
  readonly scale: number;
}

/**
 * One effect the skin wears, riding its joint.
 *
 * The driver follows the scene's clock rather than the frame, so the effect and the pose
 * it rides are sampled at one time, and a seek or a pause of the clock holds both.
 */
export function IdleEffect({ effect, system, pose, clock, scale }: IdleEffectProps) {
  const drawn = useMemo(() => drawnEmitters(system, true), [system]);
  const textures = useVfxTextures(drawn);
  const meshes = useVfxMeshes(drawn);
  const driver = useMemo(() => createDriver(IDLE_SEED), []);
  const followed = useMemo(following, []);
  const rig = useMemo(() => idleRig(pose, effect, scale), [pose, effect, scale]);

  useEffect(() => {
    driver.swap(system);
  }, [driver, system]);

  useEffect(() => {
    driver.steer(rig);
  }, [driver, rig]);

  useFrame(() => followClock(driver, clock, followed));

  return <VfxSystem drawn={drawn} driver={driver} textures={textures} meshes={meshes} />;
}
