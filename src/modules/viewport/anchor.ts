import type { Pose } from "./pose";

type Point = readonly [number, number, number];

/** A joint of a posed character, as the rig of a particle system rides it. */
export interface JointAnchor {
  /** Where the anchor stands at `time`, in the engine's space. */
  originAt(time: number): Point;
  /** How the anchor is turned at `time`, a row-major basis in the engine's space, into `out`. */
  basisInto(time: number, out: Float32Array): Float32Array;
}

/**
 * Joint `slot` of `pose` as an anchor, `offset` away from it in the joint's own frame.
 *
 * A pose and a particle pool both hold the engine's space, and the viewport carries both
 * across the one mirrored axis of world.ts, so a joint reaches the pool as it stands.
 * `scale` is the one the character is drawn at. A slot of -1 is the skeleton's own origin.
 */
export function jointAnchor(
  pose: Pose,
  slot: number,
  offset: Point = [0, 0, 0],
  scale = 1,
): JointAnchor {
  const world = new Float32Array(16);
  const [ox, oy, oz] = offset;

  const frameAt = (time: number): Float32Array => {
    if (slot < 0) {
      world.set(IDENTITY);
      return world;
    }
    return pose.worldInto(slot, time, world);
  };

  return {
    originAt(time) {
      const m = frameAt(time);
      return [
        (m[0] * ox + m[4] * oy + m[8] * oz + m[12]) * scale,
        (m[1] * ox + m[5] * oy + m[9] * oz + m[13]) * scale,
        (m[2] * ox + m[6] * oy + m[10] * oz + m[14]) * scale,
      ];
    },
    basisInto(time, out) {
      const m = frameAt(time);
      /* A column's length is the joint's scale, which a turn does not carry. */
      for (let column = 0; column < 3; column += 1) {
        const length = Math.hypot(m[column * 4], m[column * 4 + 1], m[column * 4 + 2]) || 1;
        for (let row = 0; row < 3; row += 1) {
          out[row * 3 + column] = m[column * 4 + row] / length;
        }
      }
      return out;
    },
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
