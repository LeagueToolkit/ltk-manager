/**
 * The joint buffer the `ltk-asset` scheme answers `?as=skeleton` with.
 *
 * The layout is `crates/ltk-manager-core/src/preview/skeleton.rs`'s module doc, and this
 * is the other half of it.
 */

import { BufferError, BufferReader } from "./bufferReader";

/** `LTKS`, the word a joint buffer opens with. */
const MAGIC = 0x534b544c;

/** The layouts this build reads. */
const VERSIONS: readonly number[] = [1];

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** One joint of a skeleton, in the file's own space and units. */
export interface JointModel {
  readonly name: string;
  /** The ELF hash of the lowercased name, which a clip names the joint's track by. */
  readonly hash: number;
  /** The parent's slot, and -1 for a root. */
  readonly parent: number;
  /** The bind pose in the parent's space: translation, rotation `x y z w`, scale. */
  readonly translation: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
  /** The inverse of the joint's bind pose in the skeleton's space, column-major. */
  readonly inverseBind: Float32Array;
}

/** A skeleton, and the joints a mesh's skin indices reach through it. */
export interface SkeletonModel {
  readonly joints: readonly JointModel[];
  /** The joint slot each shader joint names, which a skin index points into. */
  readonly influences: Uint32Array;
}

/**
 * One skeleton out of the bytes the scheme answered.
 *
 * # Throws
 *
 * [`BufferError`] where the bytes are not a joint buffer this build reads, where the
 * counts reach past the bytes that arrived, or where a parent or an influence names a
 * joint the buffer does not hold.
 */
export function readSkeletonBuffer(bytes: ArrayBuffer): SkeletonModel {
  const reader = new BufferReader(bytes);
  reader.header(MAGIC, VERSIONS, "joint");

  const jointCount = reader.u32();
  const influenceCount = reader.u32();

  const joints: JointModel[] = [];
  for (let slot = 0; slot < jointCount; slot += 1) {
    const name = reader.text();
    const hash = reader.u32();
    const parent = reader.i32();
    if (parent < -1 || parent >= jointCount || parent === slot) {
      throw new BufferError(`Joint ${slot} names a parent the skeleton does not hold`);
    }
    const floats = reader.floats(26);
    joints.push({
      name,
      hash,
      parent,
      translation: [floats[0], floats[1], floats[2]],
      rotation: [floats[3], floats[4], floats[5], floats[6]],
      scale: [floats[7], floats[8], floats[9]],
      inverseBind: floats.slice(10, 26),
    });
  }

  const influences = reader.words(influenceCount);
  if (influences.some((slot) => slot >= jointCount)) {
    throw new BufferError("An influence names a joint the skeleton does not hold");
  }

  return { joints, influences };
}
