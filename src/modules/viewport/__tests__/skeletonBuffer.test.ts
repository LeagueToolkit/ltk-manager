import { describe, expect, it } from "vitest";

import { BufferError } from "../bufferReader";
import { readSkeletonBuffer } from "../skeletonBuffer";

const MAGIC = 0x534b544c;

interface HeldJoint {
  name: string;
  hash: number;
  parent: number;
  /** Translation, rotation, scale and the inverse bind, 26 floats. */
  floats?: number[];
}

interface Held {
  joints: HeldJoint[];
  influences: number[];
  magic?: number;
  version?: number;
}

const BIND = [1, 2, 3, 0, 0, 0, 1, 1, 1, 1, ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, -2, -3, 1]];

/** The buffer `skeleton.rs` writes, built here so both halves of the layout are asserted. */
function buffer(held: Held): ArrayBuffer {
  const names = held.joints.map((joint) => new TextEncoder().encode(joint.name));
  const bytes =
    4 * 4 +
    names.reduce((sum, name) => sum + 4 + name.length + 4 + 4 + 26 * 4, 0) +
    held.influences.length * 4;

  const out = new ArrayBuffer(bytes);
  const view = new DataView(out);
  let at = 0;
  const u32 = (value: number) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const i32 = (value: number) => {
    view.setInt32(at, value, true);
    at += 4;
  };

  u32(held.magic ?? MAGIC);
  u32(held.version ?? 1);
  u32(held.joints.length);
  u32(held.influences.length);
  held.joints.forEach((joint, slot) => {
    u32(names[slot].length);
    for (const byte of names[slot]) {
      view.setUint8(at, byte);
      at += 1;
    }
    u32(joint.hash);
    i32(joint.parent);
    for (const value of joint.floats ?? BIND) {
      view.setFloat32(at, value, true);
      at += 4;
    }
  });
  for (const slot of held.influences) u32(slot);

  return out;
}

const TWO: Held = {
  joints: [
    { name: "Root", hash: 0x0c4f_d0e4, parent: -1 },
    { name: "Buffbone_Glb_Center_Loc", hash: 0x1234_5678, parent: 0 },
  ],
  influences: [1, 0],
};

describe("readSkeletonBuffer", () => {
  it("reads each joint's name, hash, parent and bind pose", () => {
    const skeleton = readSkeletonBuffer(buffer(TWO));

    expect(skeleton.joints.map((joint) => [joint.name, joint.hash, joint.parent])).toEqual([
      ["Root", 0x0c4f_d0e4, -1],
      ["Buffbone_Glb_Center_Loc", 0x1234_5678, 0],
    ]);
    const root = skeleton.joints[0];
    expect(root.translation).toEqual([1, 2, 3]);
    expect(root.rotation).toEqual([0, 0, 0, 1]);
    expect(root.scale).toEqual([1, 1, 1]);
    expect([...root.inverseBind]).toEqual(BIND.slice(10));
  });

  it("reads the joint slot each shader joint names", () => {
    expect([...readSkeletonBuffer(buffer(TWO)).influences]).toEqual([1, 0]);
  });

  it("reads a skeleton of no joints", () => {
    const skeleton = readSkeletonBuffer(buffer({ joints: [], influences: [] }));

    expect(skeleton.joints).toEqual([]);
    expect(skeleton.influences.length).toBe(0);
  });

  it("refuses a parent past the joints the buffer holds", () => {
    const held: Held = { ...TWO, joints: [TWO.joints[0], { ...TWO.joints[1], parent: 2 }] };

    expect(() => readSkeletonBuffer(buffer(held))).toThrow(BufferError);
  });

  it("refuses a joint that is its own parent", () => {
    const held: Held = { ...TWO, joints: [TWO.joints[0], { ...TWO.joints[1], parent: 1 }] };

    expect(() => readSkeletonBuffer(buffer(held))).toThrow(BufferError);
  });

  it("refuses an influence past the joints the buffer holds", () => {
    expect(() => readSkeletonBuffer(buffer({ ...TWO, influences: [0, 2] }))).toThrow(BufferError);
  });

  it("refuses bytes that are no joint buffer", () => {
    expect(() => readSkeletonBuffer(buffer({ ...TWO, magic: 0xdeadbeef }))).toThrow(BufferError);
  });

  it("refuses a version this build does not read", () => {
    expect(() => readSkeletonBuffer(buffer({ ...TWO, version: 2 }))).toThrow(BufferError);
  });

  it("refuses a buffer that ends before the counts in its header", () => {
    const whole = buffer(TWO);

    expect(() => readSkeletonBuffer(whole.slice(0, whole.byteLength - 4))).toThrow(BufferError);
  });
});
