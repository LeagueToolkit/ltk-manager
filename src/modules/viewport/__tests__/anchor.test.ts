import { describe, expect, it } from "vitest";

import { jointAnchor } from "../anchor";
import { createPose } from "../pose";
import type { JointModel, SkeletonModel } from "../skeletonBuffer";

/** A joint standing at `(1, 2, 3)`, a quarter turned about up and doubled. */
const JOINT: JointModel = {
  name: "Weapon",
  hash: 1,
  parent: -1,
  translation: [1, 2, 3],
  rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
  scale: [2, 2, 2],
  inverseBind: new Float32Array(16),
};

const SKELETON: SkeletonModel = { joints: [JOINT], influences: Uint32Array.of(0) };

function rounded(values: ArrayLike<number>): number[] {
  return Array.from(values, (value) => Math.round(value * 1e5) / 1e5 + 0);
}

describe("jointAnchor", () => {
  it("stands where the joint does, in the space the pool holds", () => {
    const anchor = jointAnchor(createPose(SKELETON, null), 0);

    expect(rounded(anchor.originAt(0))).toEqual([1, 2, 3]);
  });

  it("turns as the joint does, without its scale", () => {
    const anchor = jointAnchor(createPose(SKELETON, null), 0);

    expect(rounded(anchor.basisInto(0, new Float32Array(9)))).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });

  it("carries an offset along the joint's own frame", () => {
    const anchor = jointAnchor(createPose(SKELETON, null), 0, [1, 0, 0]);

    /* The quarter turn takes the joint's +X to -Z, and the scale doubles the reach. */
    expect(rounded(anchor.originAt(0))).toEqual([1, 2, 1]);
  });

  it("stands where the character's scale carries the joint", () => {
    const anchor = jointAnchor(createPose(SKELETON, null), 0, [0, 0, 0], 2);

    expect(rounded(anchor.originAt(0))).toEqual([2, 4, 6]);
  });

  it("stands at the skeleton's origin for slot -1, unturned", () => {
    const anchor = jointAnchor(createPose(SKELETON, null), -1, [4, 5, 6]);

    expect(rounded(anchor.originAt(0))).toEqual([4, 5, 6]);
    expect(rounded(anchor.basisInto(0, new Float32Array(9)))).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});
