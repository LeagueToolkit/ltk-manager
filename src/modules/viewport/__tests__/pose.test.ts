import { describe, expect, it } from "vitest";

import type { ClipModel } from "../clipBuffer";
import { createPose, LOCAL_FLOATS } from "../pose";
import type { JointModel, Quat, SkeletonModel, Vec3 } from "../skeletonBuffer";

/** A quarter turn about the up axis, and the eighth halfway to it. */
const QUARTER: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const EIGHTH: Quat = [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)];
const STILL: Quat = [0, 0, 0, 1];

function joint(
  name: string,
  hash: number,
  parent: number,
  translation: Vec3,
  rotation: Quat = STILL,
): JointModel {
  return {
    name,
    hash,
    parent,
    translation,
    rotation,
    scale: [1, 1, 1],
    inverseBind: new Float32Array(16),
  };
}

function skeleton(...joints: JointModel[]): SkeletonModel {
  return { joints, influences: Uint32Array.from(joints, (_, slot) => slot) };
}

/** A root a unit up and turned a quarter, and a child a unit along the root's own `x`. */
const ARM = skeleton(
  joint("Root", 0x10, -1, [0, 1, 0], QUARTER),
  joint("Buffbone_Glb_Center_Loc", 0x20, 0, [1, 0, 0]),
);

/** Two frames at two a second on the child alone: four units along `x` and a quarter turn. */
const REACH: ClipModel = {
  fps: 2,
  frames: 2,
  joints: Uint32Array.of(0x20),
  poses: Float32Array.of(0, 0, 0, ...STILL, 1, 1, 1, 4, 0, 0, ...QUARTER, 1, 1, 1),
};

function localOf(locals: Float32Array, slot: number): number[] {
  return rounded(locals.subarray(slot * LOCAL_FLOATS, (slot + 1) * LOCAL_FLOATS));
}

function rounded(values: ArrayLike<number>): number[] {
  return Array.from(values, (value) => Math.round(value * 1e5) / 1e5 + 0);
}

function placeOf(world: Float32Array): number[] {
  return rounded(world.subarray(12, 15));
}

describe("createPose", () => {
  it("stands every joint in its bind pose without a clip", () => {
    const pose = createPose(ARM, null);
    const locals = pose.localsInto(3, new Float32Array(2 * LOCAL_FLOATS));

    expect(pose.duration).toBe(0);
    expect(localOf(locals, 0)).toEqual(rounded([0, 1, 0, ...QUARTER, 1, 1, 1]));
    expect(localOf(locals, 1)).toEqual([1, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("places a child by its parent's transform times its own", () => {
    const pose = createPose(ARM, null);

    expect(placeOf(pose.worldInto(0, 0, new Float32Array(16)))).toEqual([0, 1, 0]);
    expect(placeOf(pose.worldInto(1, 0, new Float32Array(16)))).toEqual([0, 1, -1]);
  });

  it("lasts from the clip's first frame to its last", () => {
    expect(createPose(ARM, REACH).duration).toBe(0.5);
  });

  it("interpolates a time between two frames, slerping the turn", () => {
    const locals = createPose(ARM, REACH).localsInto(0.25, new Float32Array(2 * LOCAL_FLOATS));

    expect(localOf(locals, 1)).toEqual(rounded([2, 0, 0, ...EIGHTH, 1, 1, 1]));
  });

  it("loops the clip, wrapping at its duration", () => {
    const pose = createPose(ARM, REACH);
    const locals = new Float32Array(2 * LOCAL_FLOATS);

    expect(localOf(pose.localsInto(0.5, locals), 1).slice(0, 3)).toEqual([0, 0, 0]);
    expect(localOf(pose.localsInto(0.75, locals), 1).slice(0, 3)).toEqual([2, 0, 0]);
    expect(localOf(pose.localsInto(-0.25, locals), 1).slice(0, 3)).toEqual([2, 0, 0]);
  });

  it("holds a joint the clip has no track for in its bind pose", () => {
    const locals = createPose(ARM, REACH).localsInto(0.25, new Float32Array(2 * LOCAL_FLOATS));

    expect(localOf(locals, 0)).toEqual(rounded([0, 1, 0, ...QUARTER, 1, 1, 1]));
  });

  it("carries a child along with the clip, under its parent", () => {
    const pose = createPose(ARM, REACH);

    expect(placeOf(pose.worldInto(1, 0.25, new Float32Array(16)))).toEqual([0, 1, -2]);
  });

  it("answers the same world for a time whatever was asked before it", () => {
    const pose = createPose(ARM, REACH);
    const first = rounded(pose.worldInto(1, 0.1, new Float32Array(16)));
    pose.worldInto(1, 0.4, new Float32Array(16));

    expect(rounded(pose.worldInto(1, 0.1, new Float32Array(16)))).toEqual(first);
  });

  it("shares one parent table between every pose of a skeleton", () => {
    expect(createPose(ARM, REACH).parents).toBe(createPose(ARM, null).parents);
  });

  it("breaks a parent cycle at a root rather than walking it forever", () => {
    const looped = skeleton(
      joint("a", 1, 1, [1, 0, 0]),
      joint("b", 2, 0, [0, 1, 0]),
      joint("c", 3, -1, [0, 0, 1]),
    );
    const pose = createPose(looped, null);

    expect([...pose.parents]).toEqual([-1, 0, -1]);
    expect(placeOf(pose.worldInto(1, 0, new Float32Array(16)))).toEqual([1, 1, 0]);
  });
});

describe("jointNamed", () => {
  it("finds a joint without regard to case", () => {
    const pose = createPose(ARM, null);

    expect(pose.jointNamed("buffbone_glb_center_loc")).toBe(1);
    expect(pose.jointNamed("ROOT")).toBe(0);
  });

  it("answers the first of two joints sharing a name", () => {
    const twice = skeleton(joint("Hand", 1, -1, [0, 0, 0]), joint("hand", 2, 0, [0, 0, 0]));

    expect(createPose(twice, null).jointNamed("HAND")).toBe(0);
  });

  it("answers -1 for a name no joint carries", () => {
    expect(createPose(ARM, null).jointNamed("Weapon")).toBe(-1);
  });
});
