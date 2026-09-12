import { describe, expect, it } from "vitest";

import type { AnimationClip, AssetRef, IdleEffect, SkinModel } from "@/lib/tauri";
import { createPose, jointAnchor, type JointModel, type SkeletonModel } from "@/modules/viewport";

import { BIND_POSE, idleRig, openingClip, textureAssets, textureOf } from "../skinScene";

function chunk(pathHash: string): AssetRef {
  return { kind: "gameChunk", wad: "Champions/Ahri.wad.client", pathHash };
}

function skin(over: Partial<SkinModel> = {}): SkinModel {
  return {
    mesh: null,
    skeleton: null,
    texture: null,
    overrides: [],
    hidden: [],
    scale: null,
    animationGraph: null,
    idleEffects: [],
    ...over,
  };
}

function clip(name: string, hash: string): AnimationClip {
  return { name, hash, animation: { path: `${name}.anm`, asset: null } };
}

function joint(name: string, parent: number, translation: [number, number, number]): JointModel {
  return {
    name,
    hash: 0,
    parent,
    translation,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    inverseBind: new Float32Array(16),
  };
}

const SKELETON: SkeletonModel = {
  joints: [joint("Root", -1, [0, 0, 0]), joint("R_Hand", 0, [10, 20, 30])],
  influences: Uint32Array.of(0, 1),
};

function effect(over: Partial<IdleEffect> = {}): IdleEffect {
  return {
    effectKey: "0x00000001",
    system: "0x00000002",
    bone: "r_hand",
    targetBone: "",
    position: [0, 5, 0],
    ...over,
  };
}

describe("openingClip", () => {
  it("opens on the first idle clip, without regard to case", () => {
    const clips = [clip("Run", "0x1"), clip("IDLE_Base", "0x2"), clip("idle2", "0x3")];

    expect(openingClip(clips)?.hash).toBe("0x2");
  });

  it("opens on none where the graph holds no idle clip", () => {
    expect(openingClip([clip("Run", "0x1")])).toBeNull();
  });

  it("keeps the bind pose apart from every clip hash", () => {
    expect(BIND_POSE.startsWith("0x")).toBe(false);
  });
});

describe("textureAssets", () => {
  it("keys the skin's texture and each override's, leaving out one nothing holds", () => {
    const assets = textureAssets(
      skin({
        texture: { path: "base.tex", asset: chunk("01") },
        overrides: [
          { submesh: "Wings", texture: { path: "wings.tex", asset: chunk("02") } },
          { submesh: "Tail", texture: { path: "tail.tex", asset: null } },
        ],
      }),
    );

    expect(assets.size).toBe(2);
    expect(textureOf(assets, "WINGS")).toEqual(chunk("02"));
    expect(textureOf(assets, "Body")).toEqual(chunk("01"));
    expect(textureOf(assets, "Tail")).toEqual(chunk("01"));
  });

  it("draws a submesh with nothing where the skin names no texture", () => {
    expect(textureOf(textureAssets(skin()), "Body")).toBeNull();
  });
});

describe("idleRig", () => {
  const pose = createPose(SKELETON, null);

  it("rides the joint its bone names, offset and scaled, once and on the ground", () => {
    const rig = idleRig(pose, effect(), 2);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.life).toBe("once");
    expect(rig.height).toBe(0);
    expect(rig.motion.anchor.originAt(0)).toEqual(jointAnchor(pose, 1, [0, 5, 0], 2).originAt(0));
    expect(rig.motion.target).toBeNull();
  });

  it("aims at the joint its target bone names", () => {
    const rig = idleRig(pose, effect({ targetBone: "Root" }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.target?.originAt(0)).toEqual(jointAnchor(pose, 0).originAt(0));
  });

  it("aims nowhere at a target bone the skeleton lacks", () => {
    const rig = idleRig(pose, effect({ targetBone: "Weapon" }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.target).toBeNull();
  });

  it("stands at the skeleton's origin for a bone the skeleton lacks", () => {
    const rig = idleRig(pose, effect({ bone: "Weapon", position: [1, 2, 3] }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.anchor.originAt(0)).toEqual([1, 2, 3]);
  });

  it("resolves its joints by name without regard to case", () => {
    const rig = idleRig(pose, effect(), 2);

    expect(rig.joints?.("r_hand")?.originAt(0)).toEqual(
      jointAnchor(pose, 1, [0, 0, 0], 2).originAt(0),
    );
    expect(rig.joints?.("R_HAND")?.originAt(0)).toEqual(
      jointAnchor(pose, 1, [0, 0, 0], 2).originAt(0),
    );
  });

  it("answers null for a joint the skeleton lacks", () => {
    const rig = idleRig(pose, effect(), 1);

    expect(rig.joints?.("Weapon")).toBeNull();
  });
});
