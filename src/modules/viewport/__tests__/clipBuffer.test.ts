import { describe, expect, it } from "vitest";

import { BufferError } from "../bufferReader";
import { clipDuration, POSE_FLOATS, readClipBuffer } from "../clipBuffer";

const MAGIC = 0x414b544c;

interface Held {
  fps: number;
  frames: number;
  joints: number[];
  poses: number[];
  magic?: number;
  version?: number;
}

/** The buffer `animation.rs` writes, built here so both halves of the layout are asserted. */
function buffer(held: Held): ArrayBuffer {
  const out = new ArrayBuffer(5 * 4 + held.joints.length * 4 + held.poses.length * 4);
  const view = new DataView(out);
  let at = 0;
  const u32 = (value: number) => {
    view.setUint32(at, value, true);
    at += 4;
  };
  const f32 = (value: number) => {
    view.setFloat32(at, value, true);
    at += 4;
  };

  u32(held.magic ?? MAGIC);
  u32(held.version ?? 1);
  f32(held.fps);
  u32(held.frames);
  u32(held.joints.length);
  for (const hash of held.joints) u32(hash);
  for (const value of held.poses) f32(value);

  return out;
}

/** One joint over two frames, stepping one unit along `x`. */
const STEP: Held = {
  fps: 30,
  frames: 2,
  joints: [0xabcd_0123],
  poses: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1],
};

describe("readClipBuffer", () => {
  it("reads the rate, the frames, the joints and every pose", () => {
    const clip = readClipBuffer(buffer(STEP));

    expect(clip.fps).toBe(30);
    expect(clip.frames).toBe(2);
    expect([...clip.joints]).toEqual([0xabcd_0123]);
    expect(clip.poses.length).toBe(2 * POSE_FLOATS);
    expect([...clip.poses]).toEqual(STEP.poses);
  });

  it("refuses a clip of no frames per second", () => {
    expect(() => readClipBuffer(buffer({ ...STEP, fps: 0 }))).toThrow(BufferError);
  });

  it("refuses a clip of no frames", () => {
    expect(() => readClipBuffer(buffer({ ...STEP, frames: 0, poses: [] }))).toThrow(BufferError);
  });

  it("refuses bytes that are no pose buffer", () => {
    expect(() => readClipBuffer(buffer({ ...STEP, magic: 0xdeadbeef }))).toThrow(BufferError);
  });

  it("refuses a buffer that ends before the counts in its header", () => {
    const whole = buffer(STEP);

    expect(() => readClipBuffer(whole.slice(0, whole.byteLength - 4))).toThrow(BufferError);
  });
});

describe("clipDuration", () => {
  it("spans the first frame to the last", () => {
    const clip = readClipBuffer(buffer({ ...STEP, frames: 31, joints: [], poses: [] }));

    expect(clipDuration(clip)).toBe(1);
  });

  it("is zero for a clip of one frame", () => {
    const clip = readClipBuffer(buffer({ ...STEP, frames: 1, joints: [], poses: [] }));

    expect(clipDuration(clip)).toBe(0);
  });
});
