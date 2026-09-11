import type { Lineage } from "./children";
import type { SystemModel } from "./model";
import { createPool, type Pool } from "./pool";
import { lingerSeconds, peak } from "./systemModel";

/** The least and most room one child's pool holds, in particles. */
const CHILD_CAPACITY = { least: 16, most: 4096 } as const;

/** How many reaped pools of one capacity wait for the next child of that size. */
const SPARE_POOLS = 32;

/** Room for every particle one child of `system` holds at once, off its emitters' own rates. */
export function capacityOf(system: SystemModel): number {
  let wanted = 0;
  for (const emitter of system.emitters) {
    if (emitter.disabled) continue;
    const rate = peak(emitter.rate);
    wanted += emitter.singleParticle
      ? Math.max(Math.trunc(rate) & 0xffff, 1)
      : Math.ceil(rate * (peak(emitter.particleLifetime) + lingerSeconds(emitter))) +
        Math.ceil(rate) +
        1;
  }

  let capacity: number = CHILD_CAPACITY.least;
  while (capacity < wanted && capacity < CHILD_CAPACITY.most) capacity *= 2;
  return capacity;
}

export function takePool(lineage: Lineage, capacity: number): Pool {
  const pool = lineage.spare.get(capacity)?.pop();
  if (pool === undefined) return createPool(capacity);
  pool.count = 0;
  pool.born = 0;
  return pool;
}

export function givePool(lineage: Lineage, pool: Pool, capacity: number): void {
  const spare = lineage.spare.get(capacity) ?? [];
  if (spare.length < SPARE_POOLS) spare.push(pool);
  lineage.spare.set(capacity, spare);
}
