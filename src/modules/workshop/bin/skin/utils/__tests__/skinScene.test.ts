import { describe, expect, it } from "vitest";

import type {
  AssetRef,
  GraphClip,
  JointEffect,
  MaterialPreview,
  MaterialProgram,
  OutlineMaterial,
  SkinModel,
  SkinOutline,
  SubmeshOverride,
} from "@/lib/tauri";
import { createPose, jointAnchor, type JointModel, type SkeletonModel } from "@/modules/viewport";

import {
  BIND_POSE,
  bindingOf,
  shadingOf,
  jointRig,
  nearestValue,
  openingClip,
  outlineMaskAssets,
  outlineMaterialHashes,
  parameterValues,
  playableClips,
  playlistOf,
  dataTextureAssets,
  skinOutlineOf,
  submeshOutline,
  textureAssets,
} from "../skinScene";

function chunk(pathHash: string): AssetRef {
  return { kind: "gameChunk", wad: "Champions/Ahri.wad.client", pathHash };
}

function skin(over: Partial<SkinModel> = {}): SkinModel {
  return {
    mesh: null,
    skeleton: null,
    texture: null,
    emissiveTexture: null,
    roughnessMetallicAoTexture: null,
    normalMapTexture: null,
    material: null,
    overrides: [],
    hidden: [],
    scale: null,
    selfIllumination: null,
    animationGraph: null,
    idleEffects: [],
    persistentConditions: [],
    effectSystems: [],
    poseModifiers: [],
    sockets: [],
    outlines: [],
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
      srcFactor: "srcAlpha",
      dstFactor: "oneMinusSrcAlpha",
      premultiplied: false,
      cutout: false,
      doubleSided: false,
      inverted: false,
      depthWrite: true,
      depthTest: true,
    },
    warnings: [],
  };
}

function clip(name: string, hash: string, atomic = true): GraphClip {
  return {
    name,
    hash,
    class: atomic ? "AtomicClipData" : "SelectorClipData",
    animation: atomic ? { path: `${name}.anm`, asset: chunk("a0") } : null,
    track: null,
    mask: null,
    syncGroup: null,
    tickDuration: null,
    events: [],
    children: [],
    parameters: [],
    interruptionGroups: [],
    flags: 0,
    ownEvents: false,
  };
}

/** A composite clip of `className` naming `children`, each declared unless it is not listed. */
function composite(name: string, hash: string, className: string, children: string[]): GraphClip {
  return {
    ...clip(name, hash, false),
    class: className,
    children: children.map((child) => ({ name: child, hash: child, declared: true })),
  };
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

function effect(over: Partial<JointEffect> = {}): JointEffect {
  return {
    effectKey: "0x00000001",
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

describe("playableClips and playlistOf", () => {
  const run = clip("Run", "0x1");
  const idle = clip("Idle1", "0x3");
  const selector = composite("Run_Selector", "0x2", "SelectorClipData", ["0x9", "0x1", "0x3"]);
  const sequence = composite("Combo", "0x4", "SequencerClipData", ["0x3", "0x2", "0x3", "0x9"]);
  const empty = composite("Gone", "0x5", "SelectorClipData", ["0x9"]);
  const clips = [run, selector, idle, sequence, empty];

  it("keeps every clip whose playlist reaches a file, whatever its kind", () => {
    expect(playableClips(clips).map((each) => each.hash)).toEqual(["0x1", "0x2", "0x3", "0x4"]);
  });

  it("plays an atomic clip as itself", () => {
    expect(playlistOf(run, clips)).toEqual([run]);
  });

  it("plays a selector's first child that reaches a file", () => {
    expect(playlistOf(selector, clips)).toEqual([run]);
  });

  it("plays a sequencer's children one after another, a child listed twice twice", () => {
    expect(playlistOf(sequence, clips).map((each) => each.hash)).toEqual(["0x3", "0x1", "0x3"]);
  });

  it("plays nothing for a clip reaching no file", () => {
    expect(playlistOf(empty, clips)).toEqual([]);
  });

  it("passes over a child whose file this machine does not hold", () => {
    const missing: GraphClip = {
      ...clip("Missing", "0x7"),
      animation: { path: "missing.anm", asset: null },
    };
    const picker = composite("Picker", "0x8", "SelectorClipData", ["0x7", "0x1"]);

    expect(playlistOf(picker, [missing, picker, run])).toEqual([run]);
    expect(playableClips([missing]).length).toBe(0);
  });

  it("passes over a child that is its own ancestor", () => {
    const a = composite("A", "0xa", "SequencerClipData", ["0xb", "0x1"]);
    const b = composite("B", "0xb", "SequencerClipData", ["0xa"]);

    expect(playlistOf(a, [a, b, run])).toEqual([run]);
  });

  describe("a parametric clip", () => {
    const turn: GraphClip = {
      ...composite("Turn", "0x6", "ParametricClipData", ["0x1", "0x9", "0x3"]),
      parameters: [-90, 0, 90],
    };

    it("plays the child nearest the parameter that reaches a file", () => {
      expect(playlistOf(turn, [...clips, turn], 80)).toEqual([idle]);
      expect(playlistOf(turn, [...clips, turn], -10)).toEqual([run]);
      expect(playlistOf(turn, [...clips, turn], 10)).toEqual([idle]);
    });

    it("plays its first child with no parameter set", () => {
      expect(playlistOf(turn, [...clips, turn])).toEqual([run]);
    });

    it("lists its values once each in order, and nothing for one value", () => {
      expect(parameterValues({ ...turn, parameters: [90, -90, 0, 90] })).toEqual([-90, 0, 90]);
      expect(parameterValues({ ...turn, parameters: [5, null] })).toBeNull();
      expect(parameterValues({ ...turn, parameters: [5, 5] })).toBeNull();
      expect(parameterValues(run)).toBeNull();
    });

    it("snaps to the nearest value, the earlier of two at one distance", () => {
      expect(nearestValue([-90, 0, 90], 80)).toBe(90);
      expect(nearestValue([-90, 0, 90], -45)).toBe(-90);
      expect(nearestValue([-90, 0, 90], 400)).toBe(90);
    });
  });
});

describe("textureAssets and bindingOf", () => {
  const textured = skin({
    texture: { path: "base.tex", asset: chunk("01") },
    overrides: [
      {
        submesh: "Wings",
        texture: { path: "wings.tex", asset: chunk("02") },
        material: null,
        roughnessMetallicAoTexture: null,
        normalMapTexture: null,
      },
      {
        submesh: "Tail",
        texture: { path: "tail.tex", asset: null },
        material: null,
        roughnessMetallicAoTexture: null,
        normalMapTexture: null,
      },
    ],
  });

  it("keys the skin's texture and each override's, leaving out one nothing holds", () => {
    const assets = textureAssets(textured);

    expect(assets.size).toBe(2);
    expect(bindingOf(textured, assets, "WINGS").texture).toEqual(chunk("02"));
    expect(bindingOf(textured, assets, "Body").texture).toEqual(chunk("01"));
    expect(bindingOf(textured, assets, "Tail").texture).toEqual(chunk("01"));
  });

  it("draws a submesh with nothing where the skin names no texture", () => {
    const bare = skin();

    expect(bindingOf(bare, textureAssets(bare), "Body")).toEqual({
      material: null,
      base: null,
      texture: null,
      pbr: null,
      emissive: null,
    });
  });

  it("keys a material's base once per material, and binds its submeshes to it", () => {
    const body = material("0x1", chunk("10"));
    const wings = material("0x2", chunk("20"));
    const bound = skin({
      texture: { path: "base.tex", asset: chunk("01") },
      material: body,
      overrides: [
        {
          submesh: "Wings",
          texture: null,
          material: wings,
          roughnessMetallicAoTexture: null,
          normalMapTexture: null,
        },
        {
          submesh: "Cape",
          texture: { path: "cape.tex", asset: chunk("02") },
          material: null,
          roughnessMetallicAoTexture: null,
          normalMapTexture: null,
        },
      ],
    });
    const assets = textureAssets(bound);

    expect(assets.size).toBe(4);
    expect(bindingOf(bound, assets, "Body")).toEqual({
      material: body,
      base: chunk("10"),
      texture: chunk("01"),
      pbr: null,
      emissive: null,
    });
    expect(bindingOf(bound, assets, "wings")).toEqual({
      material: wings,
      base: chunk("20"),
      texture: chunk("01"),
      pbr: null,
      emissive: null,
    });
  });

  it("draws an override without a material with its texture alone, not the skin's material", () => {
    const bound = skin({
      material: material("0x1", chunk("10")),
      overrides: [
        {
          submesh: "Cape",
          texture: { path: "cape.tex", asset: chunk("02") },
          material: null,
          roughnessMetallicAoTexture: null,
          normalMapTexture: null,
        },
      ],
    });

    expect(bindingOf(bound, textureAssets(bound), "Cape")).toEqual({
      material: null,
      base: null,
      texture: chunk("02"),
      pbr: null,
      emissive: null,
    });
  });

  it("keeps the skin's material for an override naming PBR maps alone", () => {
    const body = material("0x1", chunk("10"));
    const bound = skin({
      material: body,
      overrides: [
        {
          submesh: "Cape",
          texture: null,
          material: null,
          roughnessMetallicAoTexture: null,
          normalMapTexture: { path: "cape_n.tex", asset: chunk("03") },
        },
      ],
    });

    expect(bindingOf(bound, textureAssets(bound), "Cape").material).toBe(body);
  });

  it("binds a material whose base nothing holds with no base", () => {
    const bound = skin({ material: material("0x1", null) });

    expect(bindingOf(bound, textureAssets(bound), "Body").base).toBeNull();
  });
});

describe("dataTextureAssets and bindingOf", () => {
  const override = (submesh: string, over: Partial<SubmeshOverride>): SubmeshOverride => ({
    submesh,
    texture: null,
    material: null,
    roughnessMetallicAoTexture: null,
    normalMapTexture: null,
    ...over,
  });
  const pbr = skin({
    texture: { path: "body.tex", asset: chunk("01") },
    roughnessMetallicAoTexture: { path: "body_rma.tex", asset: chunk("a1") },
    normalMapTexture: { path: "body_nm.tex", asset: chunk("b1") },
    overrides: [
      override("Hat", { roughnessMetallicAoTexture: { path: "hat_rma.tex", asset: chunk("a2") } }),
      override("Eyes", { material: material("0x1", null) }),
    ],
  });

  it("keys the skin's maps and each override's", () => {
    const maps = dataTextureAssets(pbr);

    expect([...maps.keys()]).toEqual(["rma", "normal", "rma:hat"]);
  });

  it("binds a submesh with no material to its override's maps, else the skin's", () => {
    const maps = dataTextureAssets(pbr);
    const textures = textureAssets(pbr);

    expect(bindingOf(pbr, textures, "Body", maps).pbr).toEqual({
      rma: chunk("a1"),
      normal: chunk("b1"),
    });
    expect(bindingOf(pbr, textures, "HAT", maps).pbr).toEqual({
      rma: chunk("a2"),
      normal: chunk("b1"),
    });
  });

  it("binds no maps to a submesh a material draws", () => {
    expect(bindingOf(pbr, textureAssets(pbr), "Eyes", dataTextureAssets(pbr)).pbr).toBeNull();
  });

  it("binds no maps where no roughness map is held", () => {
    const flat = skin({ normalMapTexture: { path: "body_nm.tex", asset: chunk("b1") } });

    expect(bindingOf(flat, textureAssets(flat), "Body", dataTextureAssets(flat)).pbr).toBeNull();
  });

  it("binds the skin's emissive mask to every submesh with no material, and none to the rest", () => {
    const glowing = skin({
      ...pbr,
      emissiveTexture: { path: "body_em.tex", asset: chunk("c1") },
    });
    const maps = dataTextureAssets(glowing);
    const textures = textureAssets(glowing);

    expect(maps.get("emissive")).toEqual(chunk("c1"));
    expect(bindingOf(glowing, textures, "Body", maps).emissive).toEqual(chunk("c1"));
    expect(bindingOf(glowing, textures, "Hat", maps).emissive).toEqual(chunk("c1"));
    expect(bindingOf(glowing, textures, "Eyes", maps).emissive).toBeNull();
  });
});

describe("shadingOf", () => {
  const held = (path: string) => ({ path, asset: chunk(path) });

  it("selects the base permutation without a roughness map this machine holds", () => {
    const absent = skin({ roughnessMetallicAoTexture: { path: "body_rma.tex", asset: null } });

    expect(shadingOf(skin(), "Body", true)).toBe("base");
    expect(shadingOf(absent, "Body", true)).toBe("base");
  });

  it("selects the normal feature only with a normal map and tangents", () => {
    const rma = skin({ roughnessMetallicAoTexture: held("body_rma.tex") });
    const both = skin({
      roughnessMetallicAoTexture: held("body_rma.tex"),
      normalMapTexture: held("body_nm.tex"),
    });

    expect(shadingOf(rma, "Body", true)).toBe("roughnessMetallic");
    expect(shadingOf(both, "Body", false)).toBe("roughnessMetallic");
    expect(shadingOf(both, "Body", true)).toBe("roughnessMetallicNormal");
  });

  it("reads the override's maps before the skin's", () => {
    const hat = skin({
      overrides: [
        {
          submesh: "Hat",
          texture: null,
          material: null,
          roughnessMetallicAoTexture: held("hat_rma.tex"),
          normalMapTexture: null,
        },
      ],
    });

    expect(shadingOf(hat, "hat", true)).toBe("roughnessMetallic");
    expect(shadingOf(hat, "Body", true)).toBe("base");
  });
});

describe("jointRig", () => {
  const pose = createPose(SKELETON, null);

  it("rides the joint its bone names, offset and scaled, once and on the ground", () => {
    const rig = jointRig(pose, effect(), 2);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.life).toBe("once");
    expect(rig.height).toBe(0);
    expect(rig.motion.anchor.originAt(0)).toEqual(jointAnchor(pose, 1, [0, 5, 0], 2).originAt(0));
    expect(rig.motion.target).toBeNull();
  });

  it("aims at the joint its target bone names", () => {
    const rig = jointRig(pose, effect({ targetBone: "Root" }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.target?.originAt(0)).toEqual(jointAnchor(pose, 0).originAt(0));
  });

  it("aims nowhere at a target bone the skeleton lacks", () => {
    const rig = jointRig(pose, effect({ targetBone: "Weapon" }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.target).toBeNull();
  });

  it("stands at the skeleton's origin for a bone the skeleton lacks", () => {
    const rig = jointRig(pose, effect({ bone: "Weapon", position: [1, 2, 3] }), 1);
    if (rig.motion.kind !== "bone") throw new Error("an idle effect rides a bone");

    expect(rig.motion.anchor.originAt(0)).toEqual([1, 2, 3]);
  });

  it("resolves its joints by name without regard to case", () => {
    const rig = jointRig(pose, effect(), 2);

    expect(rig.joints?.("r_hand")?.originAt(0)).toEqual(
      jointAnchor(pose, 1, [0, 0, 0], 2).originAt(0),
    );
    expect(rig.joints?.("R_HAND")?.originAt(0)).toEqual(
      jointAnchor(pose, 1, [0, 0, 0], 2).originAt(0),
    );
  });

  it("answers null for a joint the skeleton lacks", () => {
    const rig = jointRig(pose, effect(), 1);

    expect(rig.joints?.("Weapon")).toBeNull();
  });
});

const INK = "0xaaec01e5";
const GREEN_INK = "0x120314ea";
const WHITE = chunk("e4078d70e5b8ff89");

function ink(hash: string): OutlineMaterial {
  return {
    hash,
    name: null,
    color: [0, 0, 0, 1],
    width: 5,
    cameraDistance: 4500,
    depthOffset: -20,
    alpha: 1,
    mask: { path: "assets/shared/materials/white.tex", asset: WHITE },
    maskChannels: [1, 0, 0, 0],
  };
}

function outline(submeshes: string[], material: OutlineMaterial | null): SkinOutline {
  return { category: "0xe1043940", submeshes, material };
}

const INKED = skin({
  outlines: [
    outline(["Karthus_Weapon"], null),
    outline(["Karthus_Weapon", "Karthus"], ink(INK)),
    outline(["Karthus_Body"], ink(INK)),
    outline(["Cubes"], ink(GREEN_INK)),
  ],
});

describe("skinOutlineOf", () => {
  it("returns the first entry that names the submesh and has a material, without regard to case", () => {
    expect(skinOutlineOf(INKED, "karthus_weapon")?.material?.hash).toBe(INK);
    expect(skinOutlineOf(INKED, "Cubes")?.material?.hash).toBe(GREEN_INK);
  });

  it("returns null if no entry names the submesh", () => {
    expect(skinOutlineOf(INKED, "Cape")).toBeNull();
  });
});

describe("outlineMaterialHashes", () => {
  it("names each outline material once", () => {
    expect(outlineMaterialHashes(INKED)).toEqual([INK, GREEN_INK]);
  });
});

describe("outlineMaskAssets", () => {
  it("keys each held mask by its material's hash", () => {
    expect([...outlineMaskAssets(INKED)]).toEqual([
      [INK, WHITE],
      [GREEN_INK, WHITE],
    ]);
  });
});

describe("submeshOutline", () => {
  const stage = {
    id: 1,
    glsl: "#version 300 es\nvoid main() {}\n",
    sidecar: { blocks: [], textures: [], attributes: [] },
    cached: false,
  };
  const translated: MaterialProgram = {
    hash: INK,
    name: null,
    animated: true,
    kind: "skinnedMesh",
    passes: [
      {
        pass: {
          shader: "Shaders/SkinnedMesh/Jade_CharacterOutline",
          defines: [],
          runtimeSwitches: [],
          textures: [],
          params: [],
          state: {
            blendEnable: true,
            srcColor: "srcAlpha",
            dstColor: "oneMinusSrcAlpha",
            srcAlpha: "srcAlpha",
            dstAlpha: "oneMinusSrcAlpha",
            cullEnable: false,
            windingToCull: "ccw",
            depthEnable: true,
            depthCompareFunc: 3,
            writeMask: 31,
          },
          drivers: [],
          schema: null,
        },
        program: { kind: "ready", defines: [], vertex: stage, pixel: stage },
      },
    ],
    warnings: [],
  };
  const masks = new Map([[INK, "white"]]);

  it("draws the translated pass of the outline material if one translated", () => {
    const drawn = submeshOutline(INKED, [translated], new Map(), masks, "Karthus");

    expect(drawn?.material.hash).toBe(INK);
    expect(drawn?.mask).toBe("white");
    expect(drawn?.program?.material).toBe(INK);
  });

  it("draws the stock outline if no pass of the material translated", () => {
    const drawn = submeshOutline(INKED, [null], new Map(), masks, "Cubes");

    expect(drawn?.material.hash).toBe(GREEN_INK);
    expect(drawn?.mask).toBeNull();
    expect(drawn?.program).toBeNull();
  });

  it("returns null for a submesh with no outline", () => {
    expect(submeshOutline(INKED, [translated], new Map(), masks, "Cape")).toBeNull();
  });
});
