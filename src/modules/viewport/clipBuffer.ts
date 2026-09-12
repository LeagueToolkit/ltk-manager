/**
 * The pose buffer the `ltk-asset` scheme answers `?as=animation` with.
 *
 * The layout is `crates/ltk-manager-core/src/preview/animation.rs`'s module doc, and this
 * is the other half of it.
 */

import { BufferError, BufferReader } from "./bufferReader";

/** `LTKA`, the word a pose buffer opens with. */
const MAGIC = 0x414b544c;

/** The layouts this build reads. */
const VERSIONS: readonly number[] = [1];

/** The floats one joint's pose takes in a frame: translation, rotation, scale. */
export const POSE_FLOATS = 10;

/** One clip, baked into a pose per joint per frame. */
export interface ClipModel {
  /** Frames a second: frame `i` is the clip `i / fps` seconds in. */
  readonly fps: number;
  /** How many frames the table holds, the first and the last included. */
  readonly frames: number;
  /** The hash of each joint the clip poses, in table order. */
  readonly joints: Uint32Array;
  /** `frames * joints.length` poses, frame by frame, each in the joint's parent space. */
  readonly poses: Float32Array;
}

/** How long one pass of `clip` lasts, in seconds. */
export function clipDuration(clip: ClipModel): number {
  return clip.frames > 1 ? (clip.frames - 1) / clip.fps : 0;
}

/**
 * One clip out of the bytes the scheme answered.
 *
 * # Throws
 *
 * [`BufferError`] where the bytes are not a pose buffer this build reads, where the counts
 * reach past the bytes that arrived, or where the rate or the frame count is no clip.
 */
export function readClipBuffer(bytes: ArrayBuffer): ClipModel {
  const reader = new BufferReader(bytes);
  reader.header(MAGIC, VERSIONS, "pose");

  const fps = reader.f32();
  const frames = reader.u32();
  const jointCount = reader.u32();
  if (!(Number.isFinite(fps) && fps > 0) || frames < 1) {
    throw new BufferError(`A clip of ${frames} frames at ${fps} fps is no clip`);
  }

  const joints = reader.words(jointCount);
  const poses = reader.floats(frames * jointCount * POSE_FLOATS);

  return { fps, frames, joints, poses };
}
