import type { AnimationClip, AssetRef, IdleEffect, SkinModel, VfxSystem } from "@/lib/tauri";
import { jointAnchor, type Pose } from "@/modules/viewport";

import type { SystemModel } from "../vfx/model";
import { readVfxSystem } from "../vfx/readVfxSystem";
import type { Anchor, Joints, RigModel } from "../vfx/rig";

/** The value the clip picker holds for the skeleton standing in its bind pose. */
export const BIND_POSE = "bind";

/** The clip a preview opens on, the first idle one without regard to case. */
export function openingClip(clips: readonly AnimationClip[]): AnimationClip | null {
  return clips.find((clip) => clip.name.toLowerCase().startsWith("idle")) ?? null;
}

/** The key the texture a submesh no override names is loaded under. */
const BASE_TEXTURE = "";

function overrideKey(submesh: string): string {
  return `submesh:${submesh.toLowerCase()}`;
}

/** Every texture the skin draws with and this machine holds, keyed for `textureOf`. */
export function textureAssets(skin: SkinModel): Map<string, AssetRef> {
  const assets = new Map<string, AssetRef>();
  if (skin.texture?.asset) assets.set(BASE_TEXTURE, skin.texture.asset);
  for (const override of skin.overrides) {
    if (override.texture.asset) assets.set(overrideKey(override.submesh), override.texture.asset);
  }
  return assets;
}

/** The texture `submesh` draws with: its override's, then the skin's own. */
export function textureOf<T>(textures: ReadonlyMap<string, T>, submesh: string): T | null {
  return textures.get(overrideKey(submesh)) ?? textures.get(BASE_TEXTURE) ?? null;
}

/**
 * The rig an idle effect runs on: its joint, its offset, the joint it aims at, and the
 * skeleton a bone set of its own children spawns on.
 *
 * It runs once, because the engine creates an idle effect once and the system's own
 * emitters loop. A target the skeleton lacks aims nowhere.
 */
export function idleRig(pose: Pose, effect: IdleEffect, scale: number): RigModel {
  const [x, y, z] = effect.position;
  const aim = effect.targetBone === "" ? -1 : pose.jointNamed(effect.targetBone);
  return {
    motion: {
      kind: "bone",
      anchor: jointAnchor(pose, pose.jointNamed(effect.bone), [x ?? 0, y ?? 0, z ?? 0], scale),
      target: aim < 0 ? null : jointAnchor(pose, aim, [0, 0, 0], scale),
    },
    life: "once",
    height: 0,
    joints: jointsOf(pose, scale),
  };
}

/** `pose`'s joints by name without regard to case, each anchor built once. */
function jointsOf(pose: Pose, scale: number): Joints {
  const cache = new Map<string, Anchor | null>();
  return (name) => {
    const key = name.toLowerCase();
    let anchor = cache.get(key);
    if (anchor === undefined) {
      const slot = pose.jointNamed(key);
      anchor = slot >= 0 ? jointAnchor(pose, slot, [0, 0, 0], scale) : null;
      cache.set(key, anchor);
    }
    return anchor;
  };
}

const MODELS = new WeakMap<VfxSystem, SystemModel>();

/** The renderer's model of one read, the same object for as long as the read is. */
export function systemModel(read: VfxSystem): SystemModel {
  const held = MODELS.get(read);
  if (held !== undefined) return held;
  const model = readVfxSystem(read);
  MODELS.set(read, model);
  return model;
}
