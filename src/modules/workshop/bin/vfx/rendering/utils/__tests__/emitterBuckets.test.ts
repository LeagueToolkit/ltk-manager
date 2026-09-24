import { describe, expect, it } from "vitest";

import { createPool } from "../../../engine/simulation/pool";
import { bucketRange, bucketsOf } from "../emitterBuckets";

function poolOf(...emitters: number[]) {
  const pool = createPool(16);
  pool.emitter.set(emitters);
  pool.count = emitters.length;
  return pool;
}

function particlesOf(pool: ReturnType<typeof poolOf>, stamp: number, emitter: number): number[] {
  const buckets = bucketsOf(pool, stamp);
  const [first, last] = bucketRange(buckets, emitter);
  return Array.from(buckets.order.subarray(first, last));
}

describe("bucketsOf", () => {
  it("groups each emitter's particles in pool order", () => {
    const pool = poolOf(2, 0, 2, 1, 0, 2);

    expect(particlesOf(pool, 1, 0)).toEqual([1, 4]);
    expect(particlesOf(pool, 1, 1)).toEqual([3]);
    expect(particlesOf(pool, 1, 2)).toEqual([0, 2, 5]);
    expect(particlesOf(pool, 1, 3)).toEqual([]);
  });

  it("builds again on the next frame", () => {
    const pool = poolOf(0, 1);
    expect(particlesOf(pool, 1, 1)).toEqual([1]);

    pool.emitter[0] = 1;

    expect(particlesOf(pool, 1, 1)).toEqual([1]);
    expect(particlesOf(pool, 2, 1)).toEqual([0, 1]);
  });

  it("leaves out rows no emitter owns", () => {
    const pool = poolOf(-1, 0, -1);

    expect(particlesOf(pool, 1, 0)).toEqual([1]);
  });
});
