import { describe, expect, it } from "vitest";

import type { AnimationClip, AssetRef, IdleEffect, MaterialPreview, SkinModel } from "@/lib/tauri";
import { createPose, jointAnchor, type JointModel, type SkeletonModel } from "@/modules/viewport";

import { BIND_POSE, dressOf, idleRig, openingClip, textureAssets } from "../skinScene";

function chunk(pathHash: string): AssetRef {
  return { kind: "gameChunk", wad: "Champions/Ahri.wad.client", pathHash };
}

function skin(over: Partial<SkinModel> = {}): SkinModel {
  return {
    mesh: null,
    skeleton: null,
    texture: null,
    material: null,
    overrides: [],
    hidden: [],
    scale: null,
    animationGraph: null,
    idleEffects: [],
    ...over,
  };
}

function material(hash: string, base: AssetRef | null): MaterialPreview {
  return {
    hash,
    name: null,
    missing: false,
    animated: false,
    shader: null,
    base:
      base === null
        ? null
        : {
            name: "Diffuse_Texture",
            texture: { path: "base.tex", asset: base },
            rule: "exact",
            wrap: ["repeat", "repeat"],
          },
    tint: null,
    opacity: null,
    alphaTest: null,
    uvRepeat: null,
    uvScroll: null,
    renderState: {
      blending: "normal",
      premultiplied: false,
      doubleSided: false,
      inverted: false,
      depthWrite: true,
      depthTest: true,
    },
    warnings: [],
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

describe("textureAssets and dressOf", () => {
  const textured = skin({
    texture: { path: "base.tex", asset: chunk("01") },
    overrides: [
      { submesh: "Wings", texture: { path: "wings.tex", asset: chunk("02") }, material: null },
      { submesh: "Tail", texture: { path: "tail.tex", asset: null }, material: null },
    ],
  });

  it("keys the skin's texture and each override's, leaving out one nothing holds", () => {
    const assets = textureAssets(textured);

    expect(assets.size).toBe(2);
    expect(dressOf(textured, assets, "WINGS").texture).toEqual(chunk("02"));
    expect(dressOf(textured, assets, "Body").texture).toEqual(chunk("01"));
    expect(dressOf(textured, assets, "Tail").texture).toEqual(chunk("01"));
  });

  it("draws a submesh with nothing where the skin names no texture", () => {
    const bare = skin();

    expect(dressOf(bare, textureAssets(bare), "Body")).toEqual({
      material: null,
      base: null,
      texture: null,
    });
  });

  it("keys a material's base once per material, and dresses its submeshes with it", () => {
    const body = material("0x1", chunk("10"));
    const wings = material("0x2", chunk("20"));
    const dressed = skin({
      texture: { path: "base.tex", asset: chunk("01") },
      material: body,
      overrides: [
        { submesh: "Wings", texture: null, material: wings },
        { submesh: "Cape", texture: { path: "cape.tex", asset: chunk("02") }, material: null },
      ],
    });
    const assets = textureAssets(dressed);

    expect(assets.size).toBe(4);
    expect(dressOf(dressed, assets, "Body")).toEqual({
      material: body,
      base: chunk("10"),
      texture: chunk("01"),
    });
    expect(dressOf(dressed, assets, "wings")).toEqual({
      material: wings,
      base: chunk("20"),
      texture: chunk("01"),
    });
  });

  it("draws an override without a material with its texture alone, not the skin's material", () => {
    const dressed = skin({
      material: material("0x1", chunk("10")),
      overrides: [
        { submesh: "Cape", texture: { path: "cape.tex", asset: chunk("02") }, material: null },
      ],
    });

    expect(dressOf(dressed, textureAssets(dressed), "Cape")).toEqual({
      material: null,
      base: null,
      texture: chunk("02"),
    });
  });

  it("dresses a material whose base nothing holds with no base", () => {
    const dressed = skin({ material: material("0x1", null) });

    expect(dressOf(dressed, textureAssets(dressed), "Body").base).toBeNull();
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
