import type {
  AssetRef,
  GraphClip,
  HashRef,
  IdleEffect,
  KeyRef,
  MaterialPreview,
  MaterialProgram,
  SkinModel,
  VfxSystem,
} from "@/lib/tauri";
import {
  jointAnchor,
  type Pose,
  programWith,
  type SubmeshBinding,
  type SubmeshProgram,
} from "@/modules/viewport";

import { nameHash } from "../../shared/utils/binHash";
import type { SystemModel } from "../../vfx/engine/model/model";
import type { Anchor, Joints, RigModel } from "../../vfx/engine/model/rig";
import { readVfxSystem } from "../../vfx/engine/parsing/readVfxSystem";
import type { ParticleCue } from "./clipEvents";

/** The value the clip picker holds for the skeleton standing in its bind pose. */
export const BIND_POSE = "bind";

/** `SequencerClipData`, the one kind whose children play one after another. */
const SEQUENCER = "SequencerClipData";

/** `ParametricClipData`, whose children each play at a value of one parameter. */
export const PARAMETRIC = "ParametricClipData";

/** The clips a preview poses with: every one whose playlist reaches a file. */
export function playableClips(clips: readonly GraphClip[]): GraphClip[] {
  const byHash = clipsByHash(clips);
  return clips.filter((clip) => resolvePlaylist(clip, byHash, null, new Set()).length > 0);
}

/**
 * The atomic clips `clip` plays in order, and none for a clip that reaches no file.
 *
 * A sequencer plays each child in turn. A parametric clip plays the child whose value
 * lies nearest `parameter`, which stands in for the blend the engine makes between the
 * two around it. Every other composite plays the first child that reaches a file, which
 * stands in for the pick the engine makes at runtime. A child that is its own ancestor is
 * passed over.
 */
export function playlistOf(
  clip: GraphClip,
  clips: readonly GraphClip[],
  parameter: number | null = null,
): GraphClip[] {
  return resolvePlaylist(clip, clipsByHash(clips), parameter, new Set());
}

/**
 * The values a parametric clip's pairs play at, each once and in order, and null for a
 * clip that is not parametric or plays at one value alone.
 *
 * Decision 32 of docs/plans/animation-graph-table.md: a value between two pairs plays the
 * nearer, so these are the only values that mean anything.
 */
export function parameterValues(clip: GraphClip): number[] | null {
  if (clip.class !== PARAMETRIC) return null;
  const values = [...new Set(clip.parameters.flatMap((value) => (value === null ? [] : [value])))];
  if (values.length < 2) return null;
  return values.sort((a, b) => a - b);
}

/** The value of `values` nearest `value`, the earlier of two at one distance. */
export function nearestValue(values: readonly number[], value: number): number {
  return values.reduce((best, each) =>
    Math.abs(each - value) < Math.abs(best - value) ? each : best,
  );
}

function clipsByHash(clips: readonly GraphClip[]): ReadonlyMap<string, GraphClip> {
  return new Map(clips.map((clip) => [clip.hash, clip]));
}

/** The children in the order they are tried: nearest to `parameter` first for a parametric clip. */
function childOrder(clip: GraphClip, parameter: number | null): readonly KeyRef[] {
  if (clip.class !== PARAMETRIC || parameter === null) return clip.children;
  const distance = (at: number) => Math.abs((clip.parameters[at] ?? 0) - parameter);
  return clip.children
    .map((child, at) => ({ child, at }))
    .sort((a, b) => distance(a.at) - distance(b.at) || a.at - b.at)
    .map(({ child }) => child);
}

function resolvePlaylist(
  clip: GraphClip,
  byHash: ReadonlyMap<string, GraphClip>,
  parameter: number | null,
  above: Set<string>,
): GraphClip[] {
  if (clip.animation !== null) return [clip];
  if (above.has(clip.hash)) return [];
  above.add(clip.hash);
  const steps: GraphClip[] = [];
  for (const child of childOrder(clip, parameter)) {
    const held = byHash.get(child.hash);
    if (held === undefined) continue;
    const resolved = resolvePlaylist(held, byHash, parameter, above);
    steps.push(...resolved);
    if (clip.class !== SEQUENCER && resolved.length > 0) break;
  }
  above.delete(clip.hash);
  return steps;
}

/** The clip a preview opens on, the first idle one without regard to case. */
export function openingClip(clips: readonly GraphClip[]): GraphClip | null {
  return clips.find((clip) => clip.name.toLowerCase().startsWith("idle")) ?? null;
}

/** The key the texture a submesh no override names is loaded under. */
const BASE_TEXTURE = "";

function overrideKey(submesh: string): string {
  return `submesh:${submesh.toLowerCase()}`;
}

/**
 * The key a material's base texture is loaded under, one per material rather than per
 * submesh, so its wrap and tiling are set on a texture only that material draws.
 */
function materialKey(material: MaterialPreview): string {
  return `material:${material.hash}`;
}

/** Every texture the skin draws with and this machine holds, keyed for `bindingOf`. */
export function textureAssets(skin: SkinModel): Map<string, AssetRef> {
  const assets = new Map<string, AssetRef>();
  const base = (material: MaterialPreview | null) => {
    if (material?.base?.texture.asset)
      assets.set(materialKey(material), material.base.texture.asset);
  };
  if (skin.texture?.asset) assets.set(BASE_TEXTURE, skin.texture.asset);
  base(skin.material);
  for (const override of skin.overrides) {
    if (override.texture?.asset) assets.set(overrideKey(override.submesh), override.texture.asset);
    base(override.material);
  }
  return assets;
}

/**
 * What `submesh` draws with, first match winning: its override's material, else its
 * override's texture alone, else the skin's material, else the skin's texture.
 */
export function bindingOf<T>(
  skin: SkinModel,
  textures: ReadonlyMap<string, T>,
  submesh: string,
): SubmeshBinding<T> {
  const texture = textures.get(overrideKey(submesh)) ?? textures.get(BASE_TEXTURE) ?? null;
  const material = submeshMaterial(skin, submesh);
  return {
    material,
    base: material === null ? null : (textures.get(materialKey(material)) ?? null),
    texture,
  };
}

/** Every material the skin draws with, each once, as the program read is asked for them. */
export function materialHashes(skin: SkinModel): string[] {
  const materials = [skin.material, ...skin.overrides.map((override) => override.material)];
  return [
    ...new Set(
      materials.flatMap((material) =>
        material === null || material.missing ? [] : [material.hash],
      ),
    ),
  ];
}

/**
 * The translated program `submesh` draws under, its material's first pass that
 * translated, and null for a submesh whose material has none.
 */
export function programOf<T>(
  skin: SkinModel,
  programs: readonly (MaterialProgram | null)[],
  textures: ReadonlyMap<string, T>,
  submesh: string,
): SubmeshProgram<T> | null {
  const material = submeshMaterial(skin, submesh);
  if (material === null) return null;
  return programWith(programs.find((each) => each?.hash === material.hash) ?? null, textures);
}

/** The material `submesh` draws with: its override's, else the skin's, and null for neither. */
export function submeshMaterial(skin: SkinModel, submesh: string): MaterialPreview | null {
  const key = submesh.toLowerCase();
  const override = skin.overrides.find((each) => each.submesh.toLowerCase() === key) ?? null;
  return override === null ? skin.material : override.material;
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

/**
 * The rig a particle event's system runs on: its joint and the joint it aims at, sampled
 * `cue.at` seconds later than the run's own time, since the run starts when the cue fires.
 *
 * It runs once and is stopped where the event's end frame falls. A bone the skeleton lacks
 * rides the skeleton's origin, as an idle effect naming none does.
 */
export function cueRig(pose: Pose, cue: ParticleCue, scale: number): RigModel {
  const shift = (anchor: Anchor): Anchor => ({
    originAt: (time) => anchor.originAt(time + cue.at),
    basisInto: (time, out) => anchor.basisInto(time + cue.at, out),
  });
  const aim = jointSlot(pose, cue.target);
  return {
    motion: {
      kind: "bone",
      anchor: shift(jointAnchor(pose, jointSlot(pose, cue.bone), [0, 0, 0], scale)),
      target: aim < 0 ? null : shift(jointAnchor(pose, aim, [0, 0, 0], scale)),
    },
    life: "once",
    height: 0,
    stopAt: cue.until === null ? null : cue.until - cue.at,
    joints: jointsOf(pose, scale, cue.at),
  };
}

/**
 * The slot of the joint `ref` names, and -1 for none or for a name the skeleton lacks.
 *
 * A bin names a joint by hash, so the name is matched first and the hash against each
 * joint's own name after, which reaches a joint the tables do not name.
 */
export function jointSlot(pose: Pose, ref: HashRef | null): number {
  if (ref === null) return -1;
  const named = pose.jointNamed(ref.name);
  if (named >= 0) return named;
  return pose.skeleton.joints.findIndex((joint) => nameHash(joint.name) === ref.hash);
}

/** `pose`'s joints by name without regard to case, each anchor built once, `shift` seconds late. */
function jointsOf(pose: Pose, scale: number, shift = 0): Joints {
  const cache = new Map<string, Anchor | null>();
  return (name) => {
    const key = name.toLowerCase();
    let anchor = cache.get(key);
    if (anchor === undefined) {
      const slot = pose.jointNamed(key);
      const held = slot >= 0 ? jointAnchor(pose, slot, [0, 0, 0], scale) : null;
      anchor =
        held === null || shift === 0
          ? held
          : {
              originAt: (time) => held.originAt(time + shift),
              basisInto: (time, out) => held.basisInto(time + shift, out),
            };
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
